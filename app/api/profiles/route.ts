export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

const CIRCLES_RPC_URL =
  process.env.NEXT_PUBLIC_CIRCLES_RPC_URL || "https://rpc.aboutcircles.com/";

const IPFS_GATEWAYS = [
  "https://gateway.pinata.cloud/ipfs/",
  "https://dweb.link/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://ipfs.io/ipfs/",
];

type CirclesProfile = {
  avatarType?: string | null;
  name: string;
  imageUrl: string | null;
  typeLabel?: string | null;
};

type AvatarInfo = {
  avatarType?: string | null;
  cid?: string | null;
  cidV0?: string | null;
  cidV1?: string | null;
  name?: string | null;
  previewImageUrl?: string | null;
  imageUrl?: string | null;
};

const profileCache = new Map<
  string,
  { profile: CirclesProfile; timestamp: number }
>();
const CACHE_TTL_MS = 10 * 60 * 1000;

function normalizeAddress(address: string) {
  return address.trim().toLowerCase();
}

function normalizeImageUrl(raw: unknown) {
  if (typeof raw !== "string" || !raw) return null;
  if (raw.startsWith("data:")) return raw;
  if (raw.startsWith("ipfs://")) {
    return `${IPFS_GATEWAYS[0]}${raw.replace("ipfs://", "")}`;
  }
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

function profileTypeLabel(rawType: string | null | undefined) {
  const avatarType = rawType?.toLowerCase() ?? "";
  if (avatarType.includes("group")) return "Group";
  if (avatarType.includes("org")) return "Org";
  if (avatarType.includes("human") || avatarType.includes("person")) {
    return "User";
  }
  return null;
}

function profileServiceUrl(path: string, params: Record<string, string>) {
  const url = new URL(path, CIRCLES_RPC_URL);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
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

function profileFromServiceRecord(record: Record<string, unknown>) {
  const profile = asObject(record.profile) ?? asObject(record.value) ?? record;
  const address =
    stringField(record, ["address", "avatar", "walletAddress", "owner"]) ??
    stringField(profile, ["address", "avatar", "walletAddress", "owner"]);
  const cid =
    stringField(record, ["cid", "CID", "cidV0", "cidV1"]) ??
    stringField(profile, ["cid", "CID", "cidV0", "cidV1"]);
  const name = stringField(profile, ["name"]) ?? stringField(record, ["name"]) ?? "";
  const imageUrl = normalizeImageUrl(
    stringField(profile, ["previewImageUrl", "imageUrl", "avatarUrl"]) ??
      stringField(record, ["previewImageUrl", "imageUrl", "avatarUrl"]),
  );
  const avatarType =
    stringField(profile, ["avatarType", "type", "kind"]) ??
    stringField(record, ["avatarType", "type", "kind"]);

  if (!name && !imageUrl && !cid) return null;
  return {
    address: address ? normalizeAddress(address) : null,
    avatarType,
    cid,
    name,
    imageUrl,
    typeLabel: profileTypeLabel(avatarType),
  };
}

async function fetchProfilesFromService(
  path: string,
  params: Record<string, string>,
) {
  try {
    const res = await fetch(profileServiceUrl(path, params), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return collectProfileRecords(data).flatMap((record) => {
      const profile = profileFromServiceRecord(record);
      return profile ? [profile] : [];
    });
  } catch {
    return [];
  }
}

async function getProfileFromServiceByCid(
  cid: string,
): Promise<CirclesProfile | null> {
  const profiles = await fetchProfilesFromService("profiles/get", { cid });
  const profile = profiles[0];
  return profile
    ? {
        avatarType: profile.avatarType,
        name: profile.name,
        imageUrl: profile.imageUrl,
        typeLabel: profile.typeLabel,
      }
    : null;
}

async function getProfileFromServiceByAddress(
  address: string,
): Promise<CirclesProfile | null> {
  const profiles = await fetchProfilesFromService("profiles/search", { address });
  const exact = profiles.find((profile) => profile.address === address) ?? profiles[0];
  if (!exact) return null;

  if ((!exact.name || !exact.imageUrl) && exact.cid) {
    const byCid = await getProfileFromServiceByCid(exact.cid);
    return {
      avatarType: exact.avatarType || byCid?.avatarType || null,
      name: exact.name || byCid?.name || "",
      imageUrl: exact.imageUrl || byCid?.imageUrl || null,
      typeLabel: profileTypeLabel(exact.avatarType) || byCid?.typeLabel || null,
    };
  }

  return {
    avatarType: exact.avatarType,
    name: exact.name,
    imageUrl: exact.imageUrl,
    typeLabel: exact.typeLabel,
  };
}

function profileFromAvatarInfo(info: AvatarInfo | null): CirclesProfile | null {
  if (!info) return null;
  const avatarType = typeof info.avatarType === "string" ? info.avatarType : null;
  const name = typeof info.name === "string" ? info.name : "";
  const imageUrl = normalizeImageUrl(info.previewImageUrl || info.imageUrl);
  if (!name && !imageUrl) return null;
  return {
    avatarType,
    name,
    imageUrl,
    typeLabel: profileTypeLabel(avatarType),
  };
}

async function getAvatarInfo(address: string): Promise<AvatarInfo | null> {
  try {
    const res = await fetch(CIRCLES_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "circles_getAvatarInfo",
        params: [address],
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data?.result ?? null;
  } catch {
    return null;
  }
}

async function fetchFromGateway(
  gateway: string,
  cid: string,
): Promise<CirclesProfile | null> {
  try {
    const res = await fetch(`${gateway}${cid}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const name = typeof data?.name === "string" ? data.name : "";
    const imageUrl = normalizeImageUrl(data?.previewImageUrl || data?.imageUrl);
    if (!name && !imageUrl) return null;
    return { name, imageUrl };
  } catch {
    return null;
  }
}

async function getProfileFromIpfs(cid: string): Promise<CirclesProfile | null> {
  const result = await Promise.any(
    IPFS_GATEWAYS.map(async (gateway) => {
      const profile = await fetchFromGateway(gateway, cid);
      if (!profile) throw new Error("no profile");
      return profile;
    }),
  ).catch(() => null);

  return result;
}

async function fetchProfile(address: string): Promise<CirclesProfile> {
  const normalized = normalizeAddress(address);
  const cached = profileCache.get(normalized);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.profile;
  }

  const serviceProfile = await getProfileFromServiceByAddress(normalized);
  const avatarInfo = await getAvatarInfo(normalized);
  const directProfile = profileFromAvatarInfo(avatarInfo);
  const cid = avatarInfo?.cidV0 || avatarInfo?.cid || avatarInfo?.cidV1 || null;
  const serviceCidProfile = cid ? await getProfileFromServiceByCid(cid) : null;
  const ipfsProfile = cid ? await getProfileFromIpfs(cid) : null;

  const result = {
    avatarType:
      serviceProfile?.avatarType ||
      directProfile?.avatarType ||
      serviceCidProfile?.avatarType ||
      null,
    name:
      serviceProfile?.name ||
      directProfile?.name ||
      serviceCidProfile?.name ||
      ipfsProfile?.name ||
      "",
    imageUrl:
      serviceProfile?.imageUrl ||
      directProfile?.imageUrl ||
      serviceCidProfile?.imageUrl ||
      ipfsProfile?.imageUrl ||
      null,
    typeLabel:
      serviceProfile?.typeLabel ||
      directProfile?.typeLabel ||
      serviceCidProfile?.typeLabel ||
      null,
  };
  profileCache.set(normalized, { profile: result, timestamp: Date.now() });
  return result;
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

    const limited = addresses
      .slice(0, 100)
      .filter((address): address is string => typeof address === "string");
    const profiles: Record<string, CirclesProfile> = {};

    await Promise.all(
      limited.map(async (address) => {
        profiles[normalizeAddress(address)] = await fetchProfile(address);
      }),
    );

    return NextResponse.json({ profiles });
  } catch (error) {
    console.error("Profiles fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch profiles" },
      { status: 500 },
    );
  }
}
