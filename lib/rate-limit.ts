import { NextRequest, NextResponse } from "next/server";

type Bucket = number[];

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

function clientIp(headers: Headers) {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip") || "unknown";
}

function sweep(now: number, windowMs: number) {
  for (const [key, entries] of buckets) {
    const alive = entries.filter((ts) => now - ts < windowMs);
    if (alive.length === 0) buckets.delete(key);
    else buckets.set(key, alive);
  }
}

export async function enforceRateLimit(
  req: NextRequest,
  scope: string,
  max = 10,
  windowMs = 60_000,
) {
  const now = Date.now();
  if (now - lastSweep > windowMs) {
    sweep(now, windowMs);
    lastSweep = now;
  }

  const key = `${scope}:${clientIp(req.headers)}`;
  const recent = (buckets.get(key) || []).filter((ts) => now - ts < windowMs);
  if (recent.length >= max) {
    const retryAfterSec = Math.max(
      1,
      Math.ceil((recent[0] + windowMs - now) / 1000),
    );
    return NextResponse.json(
      { error: "rate_limited", retryAfterSec, limit: max },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }

  recent.push(now);
  buckets.set(key, recent);
  return null;
}
