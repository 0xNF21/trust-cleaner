import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { and, eq, sql } from "drizzle-orm";
import { createPublicClient, hashMessage as viemHashMessage, http } from "viem";
import { gnosis } from "viem/chains";

import { getDb } from "@/lib/db";
import { authChallenges, authSessions, type AuthChallengeRow, type AuthSessionRow } from "@/lib/db/schema";
import { buildAuthPaymentData } from "@/lib/circles";

export const AUTH_COOKIE_NAME = "trust_cleaner_auth";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_HARD_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_THROTTLE_MS = 60 * 60 * 1000;
const CHALLENGE_TTL_SIGN_MS = 5 * 60 * 1000;
const CHALLENGE_TTL_PAYMENT_MS = 30 * 60 * 1000;
const DEFAULT_AUTH_DOMAIN = "trust-cleaner";
const GNOSIS_RPC = "https://rpc.gnosischain.com";
const ERC1271_MAGIC_VALUE = "0x1626ba7e";
const ERC1271_ABI = [
  "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
];

export type AuthMethod = "miniapp_sign_message" | "payment_1crc";
export type AuthOrigin = "miniapp" | "standalone" | "unknown";

const viemClient = createPublicClient({
  chain: gnosis,
  transport: http(GNOSIS_RPC),
});

function generateToken() {
  return randomBytes(32).toString("hex");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function hashUserAgent(ua: string | null) {
  if (!ua) return null;
  return createHash("sha256").update(ua).digest("hex").slice(0, 32);
}

function generateNonce() {
  return randomBytes(16).toString("hex");
}

function readSessionToken(req: NextRequest) {
  const cookieToken = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (cookieToken) return cookieToken;

  const authorization = req.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function buildSignInMessage(
  nonce: string,
  expiresAt: Date,
  expectedAddress?: string,
  domain = DEFAULT_AUTH_DOMAIN,
) {
  const lines = [
    "Sign in to Trust Cleaner",
    "",
    `Domain: ${domain}`,
    `Nonce: ${nonce}`,
    `Expires: ${expiresAt.toISOString()}`,
  ];
  if (expectedAddress) lines.push(`Address: ${expectedAddress.toLowerCase()}`);
  return lines.join("\n");
}

export async function createAuthChallenge(opts: {
  method: AuthMethod;
  origin?: AuthOrigin;
  expectedAddress?: string;
  domain?: string;
}) {
  const nonce = generateNonce();
  const ttl =
    opts.method === "payment_1crc"
      ? CHALLENGE_TTL_PAYMENT_MS
      : CHALLENGE_TTL_SIGN_MS;
  const expiresAt = new Date(Date.now() + ttl);
  const message =
    opts.method === "miniapp_sign_message"
      ? buildSignInMessage(nonce, expiresAt, opts.expectedAddress, opts.domain)
      : buildAuthPaymentData(nonce);
  const verifyToken = opts.method === "payment_1crc" ? generateToken() : undefined;

  const [row] = await getDb()
    .insert(authChallenges)
    .values({
      method: opts.method,
      nonce,
      message,
      expectedAddress: opts.expectedAddress?.toLowerCase() ?? null,
      origin: opts.origin ?? null,
      expiresAt,
      verifyTokenHash: verifyToken ? hashToken(verifyToken) : null,
    })
    .returning({ id: authChallenges.id });

  return {
    id: row.id,
    method: opts.method,
    nonce,
    message,
    expiresAt,
    verifyToken,
  };
}

async function verifySignature(
  address: string,
  message: string,
  signature: string,
) {
  const lower = address.toLowerCase();
  const addr = lower as `0x${string}`;
  const sig = signature.startsWith("0x")
    ? (signature as `0x${string}`)
    : (`0x${signature}` as `0x${string}`);

  try {
    const valid = await viemClient.verifyMessage({
      address: addr,
      message,
      signature: sig,
    });
    if (valid) return true;
  } catch (error) {
    console.warn("[auth] viem verifyMessage failed:", error);
  }

  try {
    const recovered = ethers.verifyMessage(message, signature);
    if (recovered.toLowerCase() === lower) return true;
  } catch {}

  try {
    const provider = new ethers.JsonRpcProvider(GNOSIS_RPC);
    const contract = new ethers.Contract(address, ERC1271_ABI, provider);
    const messageHash = viemHashMessage(message);
    const result = await contract.isValidSignature(messageHash, sig);
    if (result === ERC1271_MAGIC_VALUE) return true;
  } catch (error) {
    console.warn("[auth] manual ERC-1271 failed:", error);
  }

  try {
    const provider = new ethers.JsonRpcProvider(GNOSIS_RPC);
    const contract = new ethers.Contract(address, ERC1271_ABI, provider);
    const rawMessageHash = ethers.keccak256(ethers.toUtf8Bytes(message));
    const result = await contract.isValidSignature(rawMessageHash, sig);
    if (result === ERC1271_MAGIC_VALUE) return true;
  } catch (error) {
    console.warn("[auth] raw ERC-1271 failed:", error);
  }

  return false;
}

export async function verifyMiniAppSignature(params: {
  challengeId: number;
  signature: string;
  expectedAddress: string;
}): Promise<
  | { ok: true; challenge: AuthChallengeRow; address: string }
  | { ok: false; error: string }
> {
  const expected = params.expectedAddress.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(expected)) {
    return { ok: false, error: "invalid_address" };
  }

  const [challenge] = await getDb()
    .select()
    .from(authChallenges)
    .where(eq(authChallenges.id, params.challengeId))
    .limit(1);

  if (!challenge) return { ok: false, error: "challenge_not_found" };
  if (challenge.method !== "miniapp_sign_message") return { ok: false, error: "wrong_method" };
  if (challenge.usedAt) return { ok: false, error: "challenge_already_used" };
  if (challenge.expiresAt.getTime() < Date.now()) return { ok: false, error: "challenge_expired" };
  if (challenge.status !== "pending") return { ok: false, error: "challenge_not_pending" };
  if (challenge.expectedAddress && challenge.expectedAddress !== expected) {
    return { ok: false, error: "address_mismatch" };
  }

  const valid = await verifySignature(expected, challenge.message, params.signature);
  if (!valid) {
    await getDb()
      .update(authChallenges)
      .set({ status: "rejected", errorMessage: "signature_invalid", updatedAt: new Date() })
      .where(eq(authChallenges.id, challenge.id));
    return { ok: false, error: "signature_invalid" };
  }

  const claimed = await getDb()
    .update(authChallenges)
    .set({
      status: "confirmed",
      signature: params.signature,
      usedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(authChallenges.id, challenge.id), sql`${authChallenges.usedAt} IS NULL`))
    .returning();

  if (claimed.length === 0) return { ok: false, error: "challenge_already_used" };
  return { ok: true, challenge: claimed[0], address: expected };
}

export async function verifyPaymentChallenge(params: {
  challengeId: number;
  txHash: string;
  senderAddress: string;
  verifyToken: string;
}): Promise<
  | { ok: true; challenge: AuthChallengeRow; address: string }
  | { ok: false; error: string }
> {
  const sender = params.senderAddress.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(sender)) return { ok: false, error: "invalid_address" };
  if (!/^0x[a-f0-9]{64}$/.test(params.txHash.toLowerCase())) {
    return { ok: false, error: "invalid_tx_hash" };
  }
  if (params.verifyToken.length < 32) return { ok: false, error: "invalid_verify_token" };

  const [challenge] = await getDb()
    .select()
    .from(authChallenges)
    .where(eq(authChallenges.id, params.challengeId))
    .limit(1);

  if (!challenge) return { ok: false, error: "challenge_not_found" };
  if (challenge.method !== "payment_1crc") return { ok: false, error: "wrong_method" };
  if (challenge.usedAt) return { ok: false, error: "challenge_already_used" };
  if (challenge.expiresAt.getTime() < Date.now()) return { ok: false, error: "challenge_expired" };
  if (challenge.status !== "pending") return { ok: false, error: "challenge_not_pending" };
  if (challenge.expectedAddress && challenge.expectedAddress !== sender) {
    return { ok: false, error: "address_mismatch" };
  }
  if (!challenge.verifyTokenHash || hashToken(params.verifyToken) !== challenge.verifyTokenHash) {
    return { ok: false, error: "verify_token_mismatch" };
  }

  const claimed = await getDb()
    .update(authChallenges)
    .set({
      status: "confirmed",
      txHash: params.txHash.toLowerCase(),
      usedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(authChallenges.id, challenge.id), sql`${authChallenges.usedAt} IS NULL`))
    .returning();

  if (claimed.length === 0) return { ok: false, error: "challenge_already_used" };
  return { ok: true, challenge: claimed[0], address: sender };
}

export async function createAuthSession(params: {
  address: string;
  origin: AuthOrigin;
  challengeId?: number;
  userAgent?: string | null;
}) {
  const address = params.address.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    throw new Error("createAuthSession: invalid address");
  }

  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const hardExpiresAt = new Date(now.getTime() + SESSION_HARD_TTL_MS);

  const [row] = await getDb()
    .insert(authSessions)
    .values({
      tokenHash: hashToken(token),
      address,
      origin: params.origin,
      lastAuthChallengeId: params.challengeId ?? null,
      userAgentHash: hashUserAgent(params.userAgent ?? null),
      expiresAt,
      hardExpiresAt,
      lastActiveAt: now,
      lastRefreshedAt: now,
    })
    .returning({ id: authSessions.id });

  return { token, sessionId: row.id, expiresAt, hardExpiresAt };
}

export async function getAuthSession(req: NextRequest): Promise<AuthSessionRow | null> {
  const token = readSessionToken(req);
  if (!token) return null;

  const now = new Date();
  const [session] = await getDb()
    .select()
    .from(authSessions)
    .where(eq(authSessions.tokenHash, hashToken(token)))
    .limit(1);

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() < now.getTime()) return null;
  if (session.hardExpiresAt.getTime() < now.getTime()) return null;

  const sinceRefresh = now.getTime() - session.lastRefreshedAt.getTime();
  if (sinceRefresh > SESSION_REFRESH_THROTTLE_MS) {
    const newExpiresAt = new Date(
      Math.min(now.getTime() + SESSION_TTL_MS, session.hardExpiresAt.getTime()),
    );
    await getDb()
      .update(authSessions)
      .set({
        expiresAt: newExpiresAt,
        lastActiveAt: now,
        lastRefreshedAt: now,
      })
      .where(eq(authSessions.id, session.id));
    return {
      ...session,
      expiresAt: newExpiresAt,
      lastActiveAt: now,
      lastRefreshedAt: now,
    };
  }

  return session;
}

export async function revokeCurrentSession(req: NextRequest) {
  const token = readSessionToken(req);
  if (!token) return;

  await getDb()
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(authSessions.tokenHash, hashToken(token)),
        sql`${authSessions.revokedAt} IS NULL`,
      ),
    );
}

export function setAuthCookie(
  res: NextResponse,
  token: string,
  opts: { expiresAt: Date },
) {
  const isProd = process.env.NODE_ENV === "production";
  const maxAgeSec = Math.max(
    1,
    Math.floor((opts.expiresAt.getTime() - Date.now()) / 1000),
  );

  res.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
    maxAge: maxAgeSec,
  });
}

export function clearAuthCookie(res: NextResponse) {
  const isProd = process.env.NODE_ENV === "production";
  res.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
    maxAge: 0,
  });
}
