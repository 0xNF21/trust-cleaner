export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";

import { createAuthChallenge, type AuthMethod, type AuthOrigin } from "@/lib/auth/session";
import { generateAuthPaymentLink } from "@/lib/circles";
import { enforceRateLimit } from "@/lib/rate-limit";

const SAFE_ADDRESS = process.env.SAFE_ADDRESS || "";

function authDomainFromRequest(req: NextRequest) {
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.headers.get("host") || req.nextUrl.host;
  return host.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

export async function POST(req: NextRequest) {
  const limited = await enforceRateLimit(req, "auth-challenge", 10, 60_000);
  if (limited) return limited;

  try {
    const body = await req.json().catch(() => ({}));
    const method = body?.method as AuthMethod | undefined;
    const origin = (body?.origin as AuthOrigin | undefined) ?? "unknown";
    const expectedAddress =
      typeof body?.expectedAddress === "string" ? body.expectedAddress : undefined;

    if (method !== "miniapp_sign_message" && method !== "payment_1crc") {
      return NextResponse.json({ error: "invalid_method" }, { status: 400 });
    }
    if (expectedAddress && !/^0x[a-fA-F0-9]{40}$/.test(expectedAddress)) {
      return NextResponse.json({ error: "invalid_expected_address" }, { status: 400 });
    }

    const challenge = await createAuthChallenge({
      method,
      origin,
      expectedAddress,
      domain: authDomainFromRequest(req),
    });

    if (method === "miniapp_sign_message") {
      return NextResponse.json({
        challengeId: challenge.id,
        method,
        message: challenge.message,
        expiresAt: challenge.expiresAt.toISOString(),
      });
    }

    if (!SAFE_ADDRESS) {
      return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
    }

    const paymentLink = generateAuthPaymentLink(SAFE_ADDRESS, challenge.nonce, 1);
    const qrCode = await QRCode.toDataURL(paymentLink, { width: 300, margin: 2 }).catch(
      () => "",
    );

    return NextResponse.json({
      challengeId: challenge.id,
      method,
      nonce: challenge.nonce,
      verifyToken: challenge.verifyToken,
      paymentLink,
      qrCode,
      recipientAddress: SAFE_ADDRESS,
      amountCrc: 1,
      expiresAt: challenge.expiresAt.toISOString(),
    });
  } catch (error) {
    console.error("[auth/challenge] error:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
