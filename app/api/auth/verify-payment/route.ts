export const dynamic = "force-dynamic";

import { createHash } from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import {
  createAuthSession,
  setAuthCookie,
  verifyPaymentChallenge,
} from "@/lib/auth/session";
import { checkAllNewPayments } from "@/lib/circles";
import { getDb } from "@/lib/db";
import { authChallenges, authSessions, claimedPayments } from "@/lib/db/schema";
import { executePayout } from "@/lib/payout";
import { enforceRateLimit } from "@/lib/rate-limit";

const SAFE_ADDRESS = process.env.SAFE_ADDRESS || "";

export async function POST(req: NextRequest) {
  const limited = await enforceRateLimit(req, "auth-verify-payment", 15, 60_000);
  if (limited) return limited;

  try {
    const body = await req.json().catch(() => ({}));
    const challengeId = Number(body?.challengeId);
    const verifyToken = typeof body?.verifyToken === "string" ? body.verifyToken : "";

    if (!Number.isInteger(challengeId) || challengeId <= 0) {
      return NextResponse.json({ error: "invalid_challenge_id" }, { status: 400 });
    }
    if (!verifyToken || verifyToken.length < 32) {
      return NextResponse.json({ error: "missing_verify_token" }, { status: 400 });
    }

    const [challenge] = await getDb()
      .select()
      .from(authChallenges)
      .where(eq(authChallenges.id, challengeId))
      .limit(1);

    if (!challenge) return NextResponse.json({ status: "not_found" }, { status: 404 });
    if (challenge.method !== "payment_1crc") {
      return NextResponse.json({ error: "wrong_method" }, { status: 400 });
    }

    const providedHash = createHash("sha256").update(verifyToken).digest("hex");
    if (!challenge.verifyTokenHash || providedHash !== challenge.verifyTokenHash) {
      return NextResponse.json({ error: "verify_token_mismatch" }, { status: 401 });
    }

    if (challenge.usedAt) {
      const [existing] = await getDb()
        .select({ address: authSessions.address })
        .from(authSessions)
        .where(eq(authSessions.lastAuthChallengeId, challenge.id))
        .orderBy(desc(authSessions.createdAt))
        .limit(1);

      if (!existing?.address) {
        return NextResponse.json({ status: "stale_challenge" }, { status: 409 });
      }

      const session = await createAuthSession({
        address: existing.address,
        origin: "standalone",
        challengeId: challenge.id,
        userAgent: req.headers.get("user-agent"),
      });

      const res = NextResponse.json({
        status: "confirmed",
        authenticated: true,
        address: existing.address,
        expiresAt: session.expiresAt.toISOString(),
        sessionToken: session.token,
        recovered: true,
      });
      setAuthCookie(res, session.token, { expiresAt: session.expiresAt });
      return res;
    }

    if (challenge.expiresAt.getTime() < Date.now()) {
      return NextResponse.json({ status: "expired" });
    }

    const matchedTx = await scanForAuthPayment(challenge.nonce).catch((error) => {
      console.error("[auth/verify-payment] scan error:", error);
      return null;
    });

    if (!matchedTx) {
      return NextResponse.json({ status: "waiting" });
    }

    const verifyResult = await verifyPaymentChallenge({
      challengeId: challenge.id,
      txHash: matchedTx.txHash,
      senderAddress: matchedTx.sender,
      verifyToken,
    });

    if (!verifyResult.ok) {
      return NextResponse.json(
        { error: verifyResult.error, status: "rejected" },
        { status: 401 },
      );
    }

    const session = await createAuthSession({
      address: verifyResult.address,
      origin: "standalone",
      challengeId: verifyResult.challenge.id,
      userAgent: req.headers.get("user-agent"),
    });

    const refund = await queueAuthRefund({
      address: verifyResult.address,
      txHash: matchedTx.txHash,
      challengeId: verifyResult.challenge.id,
    });

    const res = NextResponse.json({
      status: "confirmed",
      authenticated: true,
      address: verifyResult.address,
      expiresAt: session.expiresAt.toISOString(),
      sessionToken: session.token,
      refund,
    });
    setAuthCookie(res, session.token, { expiresAt: session.expiresAt });
    return res;
  } catch (error) {
    console.error("[auth/verify-payment] error:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

async function scanForAuthPayment(nonce: string) {
  if (!SAFE_ADDRESS) return null;

  const payments = await checkAllNewPayments(1, SAFE_ADDRESS);
  const candidates = payments
    .filter((payment) => payment.authData?.nonce === nonce)
    .map((payment) => ({
      txHash: payment.transactionHash.toLowerCase(),
      sender: payment.sender.toLowerCase(),
      value: payment.value,
    }));

  if (candidates.length === 0) return null;

  const txHashes = candidates.map((candidate) => candidate.txHash);
  const claimed = await getDb()
    .select({ txHash: claimedPayments.txHash })
    .from(claimedPayments)
    .where(inArray(claimedPayments.txHash, txHashes));
  const claimedSet = new Set(claimed.map((row) => row.txHash.toLowerCase()));

  for (const candidate of candidates) {
    if (claimedSet.has(candidate.txHash)) continue;
    try {
      if (BigInt(candidate.value) !== BigInt("1000000000000000000")) continue;
    } catch {
      continue;
    }
    return { txHash: candidate.txHash, sender: candidate.sender };
  }

  return null;
}

async function queueAuthRefund(params: {
  address: string;
  txHash: string;
  challengeId: number;
}) {
  const db = getDb();
  await db
    .insert(claimedPayments)
    .values({
      txHash: params.txHash,
      purpose: "auth_refund",
      challengeId: params.challengeId,
      payerAddress: params.address,
      amountCrc: 1,
    })
    .onConflictDoNothing();

  await db
    .update(authChallenges)
    .set({ status: "refund_pending", updatedAt: new Date() })
    .where(and(eq(authChallenges.id, params.challengeId), eq(authChallenges.status, "confirmed")));

  const result = await executePayout({
    payoutKey: `trust-cleaner-auth-refund-${params.txHash}`,
    recipientAddress: params.address,
    amountCrc: 1,
    reason: "Trust Cleaner auth refund",
  });

  if (!result.success) {
    await db
      .update(authChallenges)
      .set({
        status: "refund_failed",
        errorMessage: result.error?.slice(0, 500) ?? "refund_failed",
        updatedAt: new Date(),
      })
      .where(eq(authChallenges.id, params.challengeId));
    return {
      status: "refund_failed",
      error: result.error ?? "refund_failed",
    };
  }

  await db
    .update(authChallenges)
    .set({
      status: "refund_pending",
      refundTxHash: result.transferTxHash ?? null,
      updatedAt: new Date(),
    })
    .where(eq(authChallenges.id, params.challengeId));

  return {
    status: result.status,
    transferTxHash: result.transferTxHash ?? null,
  };
}
