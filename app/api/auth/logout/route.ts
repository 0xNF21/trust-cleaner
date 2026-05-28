export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { clearAuthCookie, revokeCurrentSession } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  try {
    await revokeCurrentSession(req);
  } catch (error) {
    console.error("[auth/logout] error:", error);
  }

  const res = NextResponse.json({ ok: true });
  clearAuthCookie(res);
  return res;
}
