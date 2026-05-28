export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

const CIRCLES_RPC_URL =
  process.env.NEXT_PUBLIC_CIRCLES_RPC_URL || "https://rpc.aboutcircles.com/";
const IPFS_GATEWAY = "https://ipfs.io/ipfs/";

type ProfileSearchResult = {
  address: string;
  name: string;
  imageUrl: string | null;
};

type LegacySearchProfile = {
  avatarType?: string;
  previewImageUrl?: string | null;
  imageUrl?: string | null;
  cid?: string | null;
  address?: string | null;
  name?: string | null;
};

function normalizeImageUrl(raw: unknown) {
  if (typeof raw !== "string" || !raw) return null;
  if (raw.startsWith("data:")) return raw;
  if (raw.startsWith("ipfs://")) return `${IPFS_GATEWAY}${raw.replace("ipfs://", "")}`;
  return raw;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(record: Record<string, unknown> | null, keys: string[]) {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

function collectProfileRecords(data: unknown): Record<string, unknown>[] {
  const root = asObject(data);
  const candidates = [data, root?.result, root?.profiles, root?.data, root?.items];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.flatMap((item) => {
        const record = asObject(item);
        return record ? [record] : [];
      });
    }

    const record = asObject(candidate);
    if (record) {
      const values = Object.values(record).flatMap((item) => {
        const nested = asObject(item);
        return nested ? [nested] : [];
      });
      return values.length ? values : [record];
    }
  }

  return [];
}

async function fetchIpfsProfile(
  cid: string,
): Promise<{ previewImageUrl?: string; imageUrl?: string } | null> {
  try {
    const res = await fetch(`${IPFS_GATEWAY}${cid}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function searchProfilesFromService(query: string) {
  try {
    const url = new URL("profiles/search", CIRCLES_RPC_URL);
    url.searchParams.set("name", query);
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];

    const data = await res.json();
    const records = collectProfileRecords(data);
    const results = await Promise.all(
      records.map(async (record): Promise<ProfileSearchResult | null> => {
        const profile = asObject(record.profile) ?? asObject(record.value) ?? record;
        const address =
          stringField(record, ["address", "avatar", "walletAddress", "owner"]) ??
          stringField(profile, ["address", "avatar", "walletAddress", "owner"]);
        const name = stringField(profile, ["name"]) ?? stringField(record, ["name"]);
        let imageUrl = normalizeImageUrl(
          stringField(profile, ["previewImageUrl", "imageUrl", "avatarUrl"]) ??
            stringField(record, ["previewImageUrl", "imageUrl", "avatarUrl"]),
        );
        const cid =
          stringField(record, ["cid", "CID", "cidV0", "cidV1"]) ??
          stringField(profile, ["cid", "CID", "cidV0", "cidV1"]);

        if (!imageUrl && cid) {
          const ipfsData = await fetchIpfsProfile(cid);
          imageUrl = normalizeImageUrl(ipfsData?.previewImageUrl || ipfsData?.imageUrl);
        }

        if (!address || !name) return null;
        return { address: address.toLowerCase(), name, imageUrl };
      }),
    );

    return results
      .filter((result): result is ProfileSearchResult => result !== null)
      .slice(0, 8);
  } catch {
    return [];
  }
}

async function searchProfiles(query: string): Promise<ProfileSearchResult[]> {
  const serviceResults = await searchProfilesFromService(query);
  if (serviceResults.length) return serviceResults;

  try {
    const res = await fetch(CIRCLES_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "circles_searchProfiles",
        params: [query],
      }),
    });
    const data = await res.json();
    const profiles: LegacySearchProfile[] = Array.isArray(data?.result)
      ? data.result
      : [];
    const filtered = profiles
      .filter((profile) => profile?.avatarType === "CrcV2_RegisterHuman")
      .slice(0, 8);

    return Promise.all(
      filtered.map(async (profile) => {
        let imageUrl = normalizeImageUrl(profile?.previewImageUrl || profile?.imageUrl);
        if (!imageUrl && profile?.cid) {
          const ipfsData = await fetchIpfsProfile(profile.cid);
          imageUrl = normalizeImageUrl(ipfsData?.previewImageUrl || ipfsData?.imageUrl);
        }

        return {
          address: String(profile.address).toLowerCase(),
          name: String(profile.name),
          imageUrl,
        };
      }),
    );
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!query || query.length < 2) return NextResponse.json({ results: [] });

  const results = await searchProfiles(query);
  return NextResponse.json({ results });
}
