export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

type BackerStatus = "direct" | "none" | "unknown";

type PublicTrustSignal = {
  walletAddress: string;
  trustScore: number | null;
  trustLevel: string | null;
  confidence: number | null;
  computedAt: string | null;
  inDegree: number;
  outDegree: number;
  mutualCount: number;
  ageDays: number;
  backerStatus: BackerStatus;
  source: "circles-rpc" | "relative-trustscore" | "unavailable";
  errorMessage: string | null;
  lastFetchedAt: string;
};

type CirclesQuery = {
  Namespace: string;
  Table: string;
  Columns: string[];
  Filter?: unknown[];
  Limit?: number;
};

type CirclesQueryResult = {
  columns?: string[];
  rows?: unknown[][];
};

type TrustScoreRow = {
  avatar?: string;
  trust_score?: number | string | null;
  trust_level?: string | null;
  confidence?: number | string | null;
  computed_at?: number | string | null;
  in_degree?: number | string | null;
  out_degree?: number | string | null;
  mutual_count?: number | string | null;
  age_days?: number | string | null;
};

type RelativeTrustScoreResult = {
  address?: string;
  relative_score?: number | string | null;
};

const CIRCLES_RPC_URL =
  process.env.CIRCLES_RPC_URL ||
  process.env.NEXT_PUBLIC_CIRCLES_RPC_URL ||
  "https://rpc.aboutcircles.com/";
const TRUST_SCORE_API_URL =
  process.env.GARAGE_TRUST_SCORE_API_URL ||
  "https://squid-app-3gxnl.ondigitalocean.app/aboutcircles-advanced-analytics2";
const CACHE_TTL_MS = Math.max(
  60_000,
  Number(process.env.TRUST_CLEANER_SCORE_CACHE_SECONDS ?? 10 * 60) * 1000,
);

const trustScoreCache = new Map<
  string,
  { signal: PublicTrustSignal; timestamp: number }
>();

function normalizeAddress(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(normalized) ? normalized : null;
}

function numberOrNull(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function epochSecondsToIso(value: unknown) {
  const seconds = numberOrNull(value);
  if (!seconds || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

function filterEquals(column: string, value: string) {
  return {
    Type: "FilterPredicate",
    FilterType: "Equals",
    Column: column,
    Value: value,
  };
}

function filterIn(column: string, values: string[]) {
  return {
    Type: "FilterPredicate",
    FilterType: "In",
    Column: column,
    Value: values,
  };
}

async function circlesQuery(query: CirclesQuery) {
  const response = await fetch(CIRCLES_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "circles_query",
      params: [query],
    }),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`circles_query_http_${response.status}`);

  const payload = await response.json();
  if (payload?.error) {
    const message =
      typeof payload.error?.message === "string"
        ? payload.error.message
        : "circles_query_error";
    throw new Error(message);
  }

  const result = payload?.result as CirclesQueryResult | undefined;
  const columns = Array.isArray(result?.columns) ? result.columns : [];
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  return rows.map((row) =>
    columns.reduce<Record<string, unknown>>((record, column, index) => {
      record[column] = row[index];
      return record;
    }, {}),
  );
}

async function fetchTrustScoreRows(addresses: string[]) {
  if (!addresses.length) return new Map<string, TrustScoreRow>();

  const rows = await circlesQuery({
    Namespace: "V_TrustScores",
    Table: "Current",
    Columns: [
      "avatar",
      "trust_score",
      "trust_level",
      "confidence",
      "computed_at",
      "in_degree",
      "out_degree",
      "mutual_count",
      "age_days",
    ],
    Filter:
      addresses.length === 1
        ? [filterEquals("avatar", addresses[0])]
        : [filterIn("avatar", addresses)],
    Limit: addresses.length,
  });

  const byAddress = new Map<string, TrustScoreRow>();
  for (const row of rows) {
    const address = normalizeAddress(row.avatar);
    if (address) byAddress.set(address, row as TrustScoreRow);
  }
  return byAddress;
}

async function fetchRelativeTrustScores(addresses: string[]) {
  if (!addresses.length) return new Map<string, RelativeTrustScoreResult>();

  const response = await fetch(`${TRUST_SCORE_API_URL}/scoring/relative_trustscore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      avatars: addresses,
      target_set_name: "all_backers",
      include_details: false,
    }),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`relative_trustscore_http_${response.status}`);
  }

  const payload = await response.json();
  if (payload?.status && payload.status !== "success") {
    throw new Error("relative_trustscore_failed");
  }

  const byAddress = new Map<string, RelativeTrustScoreResult>();
  const results = Array.isArray(payload?.results) ? payload.results : [];
  for (const result of results) {
    const address = normalizeAddress(result?.address);
    if (address) byAddress.set(address, result as RelativeTrustScoreResult);
  }
  return byAddress;
}

async function fetchDirectBackers(addresses: string[]) {
  if (!addresses.length) return new Set<string>();

  const rows = await circlesQuery({
    Namespace: "CrcV2",
    Table: "CirclesBackingCompleted",
    Columns: ["backer"],
    Filter:
      addresses.length === 1
        ? [filterEquals("backer", addresses[0])]
        : [filterIn("backer", addresses)],
    Limit: addresses.length,
  });

  const backers = new Set<string>();
  for (const row of rows) {
    const backer = normalizeAddress(row.backer);
    if (backer) backers.add(backer);
  }
  return backers;
}

function fallbackSignal(address: string, message: string | null): PublicTrustSignal {
  return {
    walletAddress: address,
    trustScore: null,
    trustLevel: null,
    confidence: null,
    computedAt: null,
    inDegree: 0,
    outDegree: 0,
    mutualCount: 0,
    ageDays: 0,
    backerStatus: "unknown",
    source: "unavailable",
    errorMessage: message,
    lastFetchedAt: new Date().toISOString(),
  };
}

function buildSignal(
  address: string,
  trustScore: TrustScoreRow | undefined,
  relativeTrustScore: RelativeTrustScoreResult | undefined,
  directBackers: Set<string>,
): PublicTrustSignal {
  const relativeScore = numberOrNull(relativeTrustScore?.relative_score);
  const score =
    relativeScore === null ? numberOrNull(trustScore?.trust_score) : Math.floor(relativeScore);

  return {
    walletAddress: address,
    trustScore: score,
    trustLevel:
      typeof trustScore?.trust_level === "string" ? trustScore.trust_level : null,
    confidence: numberOrNull(trustScore?.confidence),
    computedAt: epochSecondsToIso(trustScore?.computed_at),
    inDegree: numberOrNull(trustScore?.in_degree) ?? 0,
    outDegree: numberOrNull(trustScore?.out_degree) ?? 0,
    mutualCount: numberOrNull(trustScore?.mutual_count) ?? 0,
    ageDays: numberOrNull(trustScore?.age_days) ?? 0,
    backerStatus: directBackers.has(address) ? "direct" : "none",
    source: relativeScore === null ? "circles-rpc" : "relative-trustscore",
    errorMessage: null,
    lastFetchedAt: new Date().toISOString(),
  };
}

async function fetchTrustSignals(addresses: string[]) {
  const [trustScores, relativeScores, directBackers] = await Promise.all([
    fetchTrustScoreRows(addresses).catch(() => new Map<string, TrustScoreRow>()),
    fetchRelativeTrustScores(addresses).catch(
      () => new Map<string, RelativeTrustScoreResult>(),
    ),
    fetchDirectBackers(addresses).catch(() => new Set<string>()),
  ]);

  return Object.fromEntries(
    addresses.map((address) => [
      address,
      buildSignal(
        address,
        trustScores.get(address),
        relativeScores.get(address),
        directBackers,
      ),
    ]),
  );
}

export async function POST(req: Request) {
  try {
    const { addresses } = await req.json();
    if (!Array.isArray(addresses) || addresses.length === 0) {
      return NextResponse.json(
        { error: "addresses array required" },
        { status: 400 },
      );
    }

    const normalized = Array.from(
      new Set(addresses.flatMap((address) => normalizeAddress(address) ?? [])),
    ).slice(0, 50);
    const now = Date.now();
    const trustProfiles: Record<string, PublicTrustSignal> = {};
    const missing: string[] = [];

    for (const address of normalized) {
      const cached = trustScoreCache.get(address);
      if (cached && now - cached.timestamp < CACHE_TTL_MS) {
        trustProfiles[address] = cached.signal;
      } else {
        missing.push(address);
      }
    }

    if (missing.length) {
      const fetched = await fetchTrustSignals(missing).catch(() =>
        Object.fromEntries(
          missing.map((address) => [
            address,
            fallbackSignal(address, "trust_score_unavailable"),
          ]),
        ),
      );
      for (const [address, signal] of Object.entries(fetched)) {
        trustProfiles[address] = signal;
        trustScoreCache.set(address, { signal, timestamp: now });
      }
    }

    return NextResponse.json({ trustProfiles });
  } catch (error) {
    console.error("Trust score fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch trust scores" },
      { status: 500 },
    );
  }
}
