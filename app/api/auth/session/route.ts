export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { getAuthSession } from "@/lib/auth/session";

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) {
      return NextResponse.json({ authenticated: false });
    }
    return NextResponse.json({
      authenticated: true,
      address: session.address,
      origin: session.origin,
      expiresAt: session.expiresAt.toISOString(),
      hardExpiresAt: session.hardExpiresAt.toISOString(),
    });
  } catch (error) {
    console.error("[auth/session] error:", error);
    return NextResponse.json({ authenticated: false });
  }
}
