export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import {
  createAuthSession,
  setAuthCookie,
  verifyMiniAppSignature,
} from "@/lib/auth/session";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const limited = await enforceRateLimit(req, "auth-verify-signature", 10, 60_000);
  if (limited) return limited;

  try {
    const body = await req.json().catch(() => ({}));
    const challengeId = Number(body?.challengeId);
    const signature = typeof body?.signature === "string" ? body.signature : "";
    const address = typeof body?.address === "string" ? body.address : "";

    if (!Number.isInteger(challengeId) || challengeId <= 0) {
      return NextResponse.json({ error: "invalid_challenge_id" }, { status: 400 });
    }

    const result = await verifyMiniAppSignature({
      challengeId,
      signature,
      expectedAddress: address,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 401 });
    }

    const session = await createAuthSession({
      address: result.address,
      origin: "miniapp",
      challengeId: result.challenge.id,
      userAgent: req.headers.get("user-agent"),
    });

    const res = NextResponse.json({
      authenticated: true,
      address: result.address,
      expiresAt: session.expiresAt.toISOString(),
      sessionToken: session.token,
    });
    setAuthCookie(res, session.token, { expiresAt: session.expiresAt });
    return res;
  } catch (error) {
    console.error("[auth/verify-signature] error:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
