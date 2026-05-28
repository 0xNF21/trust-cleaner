import { ethers } from "ethers";
import { eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { payouts } from "@/lib/db/schema";

const GNOSIS_RPC = "https://rpc.gnosischain.com";
const CIRCLES_HUB_V2 = "0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8";
const MAX_RETRY_ATTEMPTS = 3;

const ROLES_MOD_ABI = [
  "function execTransactionWithRole(address to, uint256 value, bytes data, uint8 operation, bytes32 roleKey, bool shouldRevert) external returns (bool success)",
];

const ERC1155_ABI = [
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
];

export type PayoutResult = {
  success: boolean;
  payoutId?: number;
  status: string;
  transferTxHash?: string;
  error?: string;
};

type PayoutRequest = {
  payoutKey: string;
  recipientAddress: string;
  amountCrc: number;
  reason: string;
};

export function getPayoutConfig() {
  const required = [
    "BOT_PRIVATE_KEY",
    "SAFE_ADDRESS",
    "ROLES_MODIFIER_ADDRESS",
    "ROLE_KEY",
    "AUTH_REFUND_TOKEN_ADDRESS",
  ];
  const missingVars = required.filter((key) => !process.env[key]);
  if (missingVars.length > 0) {
    return { configured: false, missingVars };
  }

  const wallet = new ethers.Wallet(process.env.BOT_PRIVATE_KEY!);
  return {
    configured: true,
    missingVars: [],
    botAddress: wallet.address,
    safeAddress: process.env.SAFE_ADDRESS,
    rolesModAddress: process.env.ROLES_MODIFIER_ADDRESS,
    refundTokenAddress: process.env.AUTH_REFUND_TOKEN_ADDRESS,
  };
}

function getProvider() {
  return new ethers.JsonRpcProvider(GNOSIS_RPC);
}

function getBotWallet() {
  return new ethers.Wallet(process.env.BOT_PRIVATE_KEY!, getProvider());
}

function getRoleKey(): string {
  const key = process.env.ROLE_KEY;
  if (!key) throw new Error("ROLE_KEY is not configured");
  if (key.startsWith("0x")) return key.padEnd(66, "0").slice(0, 66);
  return `0x${BigInt(key).toString(16).padStart(64, "0")}`;
}

function refundTokenId() {
  const token = process.env.AUTH_REFUND_TOKEN_ADDRESS;
  if (!token || !/^0x[a-fA-F0-9]{40}$/.test(token)) {
    throw new Error("AUTH_REFUND_TOKEN_ADDRESS is not configured");
  }
  return BigInt(token);
}

async function ensureBotState() {
  const wallet = getBotWallet();
  const pendingNonce = await wallet.provider!.getTransactionCount(
    wallet.address,
    "pending",
  );
  await getDb().execute(
    sql`INSERT INTO bot_state (id, last_nonce, updated_at)
        VALUES (1, ${pendingNonce - 1}, NOW())
        ON CONFLICT (id) DO NOTHING`,
  );
}

async function reserveNonce(): Promise<number> {
  await ensureBotState();
  const result = await getDb().execute<{ last_nonce: number }>(
    sql`UPDATE bot_state
        SET last_nonce = last_nonce + 1, updated_at = NOW()
        WHERE id = 1
        RETURNING last_nonce`,
  );
  const row = (result as { rows?: Array<{ last_nonce: number }> }).rows?.[0];
  if (!row || typeof row.last_nonce !== "number") {
    throw new Error("bot_state row missing");
  }
  return row.last_nonce;
}

async function resyncNonceFromChain(wallet: ethers.Wallet) {
  const onchainPending = await wallet.provider!.getTransactionCount(
    wallet.address,
    "pending",
  );
  const target = onchainPending - 1;
  await getDb().execute(
    sql`UPDATE bot_state
        SET last_nonce = GREATEST(last_nonce, ${target}), updated_at = NOW()
        WHERE id = 1`,
  );
}

function isNonceTooLowError(error: unknown) {
  const err = error as { code?: string; message?: string; info?: { error?: { message?: string } } };
  if (err?.code === "NONCE_EXPIRED") return true;
  const message = String(err?.message || err?.info?.error?.message || "").toLowerCase();
  return /nonce too low|nonce has already been used|already known/.test(message);
}

async function execViaRolesMod(
  targetAddress: string,
  calldata: string,
  value: bigint = BigInt(0),
  resyncAttempted = false,
): Promise<{ hash: string }> {
  const wallet = getBotWallet();
  const rolesModAddress = process.env.ROLES_MODIFIER_ADDRESS;
  if (!rolesModAddress) throw new Error("ROLES_MODIFIER_ADDRESS is not configured");

  const rolesMod = new ethers.Contract(rolesModAddress, ROLES_MOD_ABI, wallet);
  const nonce = await reserveNonce();

  try {
    const tx = await rolesMod.execTransactionWithRole(
      targetAddress,
      value,
      calldata,
      0,
      getRoleKey(),
      true,
      { nonce },
    );
    return { hash: tx.hash };
  } catch (error) {
    if (isNonceTooLowError(error) && !resyncAttempted) {
      await resyncNonceFromChain(wallet);
      return execViaRolesMod(targetAddress, calldata, value, true);
    }
    throw error;
  }
}

async function getSafeCrcBalance() {
  const safeAddress = process.env.SAFE_ADDRESS;
  if (!safeAddress) throw new Error("SAFE_ADDRESS is not configured");

  const hub = new ethers.Contract(CIRCLES_HUB_V2, ERC1155_ABI, getProvider());
  return hub.balanceOf(safeAddress, refundTokenId()) as Promise<bigint>;
}

async function transferRefundToken(recipient: string, amountWei: bigint) {
  const safeAddress = process.env.SAFE_ADDRESS;
  if (!safeAddress) throw new Error("SAFE_ADDRESS is not configured");

  const hubInterface = new ethers.Interface(ERC1155_ABI);
  const calldata = hubInterface.encodeFunctionData("safeTransferFrom", [
    safeAddress,
    recipient,
    refundTokenId(),
    amountWei,
    "0x",
  ]);
  const { hash } = await execViaRolesMod(CIRCLES_HUB_V2, calldata);
  return hash;
}

export async function executePayout(request: PayoutRequest): Promise<PayoutResult> {
  const config = getPayoutConfig();
  if (!config.configured) {
    return {
      success: false,
      status: "failed",
      error: `Payout not configured. Missing: ${config.missingVars.join(", ")}`,
    };
  }

  if (request.amountCrc <= 0) {
    return { success: false, status: "failed", error: "Amount must be greater than 0" };
  }

  const db = getDb();
  const existing = await db
    .select()
    .from(payouts)
    .where(eq(payouts.payoutKey, request.payoutKey))
    .limit(1);

  if (existing.length > 0) {
    const payout = existing[0];
    if (payout.status === "success") {
      return {
        success: false,
        status: "already_paid",
        payoutId: payout.id,
        transferTxHash: payout.transferTxHash || undefined,
      };
    }
    if (payout.status === "sending") {
      return {
        success: false,
        status: "already_sending",
        payoutId: payout.id,
        transferTxHash: payout.transferTxHash || undefined,
      };
    }
    if (payout.status === "failed" && payout.attempts >= MAX_RETRY_ATTEMPTS) {
      return {
        success: false,
        status: "max_retries",
        payoutId: payout.id,
        error: `Max retry attempts reached for ${request.payoutKey}`,
      };
    }
  }

  const [payoutRecord] =
    existing.length > 0
      ? existing
      : await db
          .insert(payouts)
          .values({
            purpose: "auth_refund",
            payoutKey: request.payoutKey,
            recipientAddress: request.recipientAddress,
            amountCrc: request.amountCrc,
            reason: request.reason,
            status: "pending",
          })
          .returning();

  const amountWei = ethers.parseEther(String(request.amountCrc));
  await db
    .update(payouts)
    .set({
      attempts: payoutRecord.attempts + 1,
      status: "pending",
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(payouts.id, payoutRecord.id));

  try {
    const balance = await getSafeCrcBalance();
    if (balance < amountWei) {
      throw new Error(
        `Insufficient Safe refund token balance. Have ${ethers.formatEther(balance)} CRC, need ${request.amountCrc}`,
      );
    }

    await db
      .update(payouts)
      .set({ status: "sending", updatedAt: new Date() })
      .where(eq(payouts.id, payoutRecord.id));

    const transferTxHash = await transferRefundToken(
      request.recipientAddress,
      amountWei,
    );

    await db
      .update(payouts)
      .set({ transferTxHash, status: "sending", updatedAt: new Date() })
      .where(eq(payouts.id, payoutRecord.id));

    return {
      success: true,
      payoutId: payoutRecord.id,
      status: "sending",
      transferTxHash,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(payouts)
      .set({
        status: "failed",
        errorMessage: message.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(payouts.id, payoutRecord.id));

    return {
      success: false,
      payoutId: payoutRecord.id,
      status: "failed",
      error: message,
    };
  }
}
