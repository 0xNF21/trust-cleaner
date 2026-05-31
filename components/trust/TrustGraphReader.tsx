"use client";

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  Gauge,
  Info,
  ListChecks,
  LogIn,
  LogOut,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UsersRound,
} from "lucide-react";

import { useAuthSession } from "@/components/auth/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useWallet } from "@/hooks/use-wallet";
import { shortenAddress } from "@/lib/utils";

type RawRelationsPage = {
  limit: number;
  size: number;
  hasMore: boolean;
  results: unknown[];
};

type TrustGraphResult = {
  address: string;
  counts: {
    trusts: number;
    trustedBy: number;
    mutualTrusts: number;
    rawRelations: number;
  };
  trusts: unknown[];
  trustedBy: unknown[];
  mutualTrusts: unknown[];
  rawRelationsPage: RawRelationsPage;
  fetchedAt: string;
  elapsedMs: number;
};

type RelationRow = {
  address: string;
  label: string;
  source: "trusts" | "trustedBy" | "mutualTrusts" | "rawRelations";
  timestamp?: string;
};

type CirclesProfile = {
  avatarType?: string | null;
  name?: string;
  imageUrl?: string | null;
  typeLabel?: string | null;
};

type ProfileSearchResult = {
  address: string;
  name: string;
  imageUrl: string | null;
};

type TrustSignal = {
  walletAddress: string;
  trustScore: number | null;
  trustLevel: string | null;
  confidence: number | null;
  computedAt: string | null;
  inDegree: number;
  outDegree: number;
  mutualCount: number;
  ageDays: number;
  backerStatus: "direct" | "none" | "unknown";
  source: "circles-rpc" | "relative-trustscore" | "unavailable";
  errorMessage: string | null;
  lastFetchedAt: string;
};

type PathfinderTransfer = {
  from: string;
  to: string;
  tokenOwner: string;
  value: string;
  valueCrc: string;
};

type PathfinderPreview = {
  from: string;
  to: string;
  pathMode?: "max" | "test";
  targetFlow: string;
  targetFlowCrc: string;
  maxFlow: string;
  maxFlowCrc: string;
  requestedFlow: string;
  requestedFlowCrc: string;
  transfers: PathfinderTransfer[];
  useWrappedBalances: boolean;
  maxTransfers: number;
};

type PathfinderState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; preview: PathfinderPreview }
  | { status: "error"; error: string };

type TrustBand = "strong" | "medium" | "low" | "unknown";

type CleanerAnalysis = {
  outgoingOnly: RelationRow[];
  incomingOnly: RelationRow[];
  mutual: RelationRow[];
  rawSample: RelationRow[];
  recommendation: string;
};

type CleanupAction = {
  id: string;
  targetAddress: string;
  reason: "outgoing-only" | "non-mutual";
  method: "removeTrust";
};

type PlanDecision = "confirm" | "later" | "keep";

type DryRunTransaction = {
  data: string;
  method: "trust(address,uint96)";
  targetAddress: string;
  targetName: string;
  targetStatus: string;
  targetType: string;
  to: string;
  value: string;
};

type DryRunState =
  | { status: "idle"; transactions: DryRunTransaction[] }
  | { error: string; status: "error"; transactions: DryRunTransaction[] }
  | { generatedAt: string; status: "ready"; transactions: DryRunTransaction[] };

type SignatureState =
  | { hashes: string[]; status: "idle" }
  | { hashes: string[]; status: "sending" }
  | { error: string; hashes: string[]; status: "error" }
  | { hashes: string[]; status: "success" };

type VerificationState =
  | { status: "idle"; targets: DryRunTransaction[] }
  | {
      startedReadVersion: string | null;
      status: "checking";
      targets: DryRunTransaction[];
    }
  | { error: string; status: "error"; targets: DryRunTransaction[] };

type CircleBucket = "keep" | "review" | "incoming";

type CircleMember = RelationRow & {
  bucket: CircleBucket;
};

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const DEFAULT_LAUNCH_ADDRESS = "0x158a0EC28264d37b6471736f29e8F68F0C927ed5";
const PATHFINDER_TARGET_FLOW = "1000000000000000000";
const PATHFINDER_MAX_TRANSFERS = 64;
const PATHFINDER_PATH_MODE = "max";
const FLOW_GRAPH_TRANSFER_LIMIT = 64;
const FLOW_ROUTE_PREVIEW_LIMIT = 6;
const CAROUSEL_MOUSE_SCROLL_DEAD_ZONE = 0.26;
const CAROUSEL_MOUSE_SCROLL_MAX_STEP = 4.5;

function normalizeAddress(value: string) {
  const normalized = value.trim().toLowerCase();
  return ADDRESS_RE.test(normalized) ? normalized : null;
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        jsonSafe(entry),
      ]),
    );
  }
  return value;
}

function formatJson(value: unknown) {
  return JSON.stringify(jsonSafe(value), null, 2);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function findCounterparty(value: unknown, owner: string) {
  if (typeof value === "string") {
    const normalized = normalizeAddress(value);
    return normalized && normalized !== owner ? normalized : null;
  }

  const record = asRecord(value);
  if (!record) return null;

  const preferredKeys = [
    "objectAvatar",
    "trustedAvatar",
    "trustee",
    "counterparty",
    "avatar",
    "address",
    "subjectAvatar",
  ];

  for (const key of preferredKeys) {
    const entry = record[key];
    if (typeof entry !== "string") continue;
    const normalized = normalizeAddress(entry);
    if (normalized && normalized !== owner) return normalized;
  }

  for (const entry of Object.values(record)) {
    if (typeof entry !== "string") continue;
    const normalized = normalizeAddress(entry);
    if (normalized && normalized !== owner) return normalized;
  }

  return null;
}

function readTimestamp(value: unknown) {
  const record = asRecord(value);
  if (!record) return undefined;
  const raw =
    record.timestamp ??
    record.blockTimestamp ??
    record.lastUpdatedAt ??
    record.createdAt;

  if (typeof raw === "number") {
    const millis = raw > 10_000_000_000 ? raw : raw * 1000;
    return new Date(millis).toLocaleDateString();
  }
  if (typeof raw === "string" && raw.trim()) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
      const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
      return new Date(millis).toLocaleDateString();
    }
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleDateString();
  }

  return undefined;
}

function relationRows(
  source: RelationRow["source"],
  label: string,
  items: unknown[],
  owner: string,
) {
  const seen = new Set<string>();
  const rows: RelationRow[] = [];

  for (const item of items) {
    const address = findCounterparty(item, owner);
    if (!address || seen.has(address)) continue;
    seen.add(address);
    rows.push({
      address,
      label,
      source,
      timestamp: readTimestamp(item),
    });
  }

  return rows;
}

function buildCleanerAnalysis(result: TrustGraphResult | null): CleanerAnalysis {
  if (!result) {
    return {
      outgoingOnly: [],
      incomingOnly: [],
      mutual: [],
      rawSample: [],
      recommendation: "Load a wallet to get a read-only cleaning preview.",
    };
  }

  const owner = result.address;
  const outgoing = relationRows("trusts", "Outgoing trust", result.trusts, owner);
  const incoming = relationRows("trustedBy", "Incoming trust", result.trustedBy, owner);
  const mutual = relationRows(
    "mutualTrusts",
    "Mutual trust",
    result.mutualTrusts,
    owner,
  );
  const rawSample = relationRows(
    "rawRelations",
    "Raw relation",
    result.rawRelationsPage.results,
    owner,
  ).slice(0, 6);
  const mutualAddresses = new Set(mutual.map((row) => row.address));
  const outgoingOnly = outgoing.filter((row) => !mutualAddresses.has(row.address));
  const incomingOnly = incoming.filter((row) => !mutualAddresses.has(row.address));

  const recommendation =
    outgoingOnly.length > 0
      ? "Review outgoing-only trusts first. This dry run does not send transactions."
      : "No outgoing-only trust detected in the SDK lists. Keep monitoring raw relations.";

  return { outgoingOnly, incomingOnly, mutual, rawSample, recommendation };
}

function cleanupRowId(row: RelationRow) {
  return `${row.source}:${row.address}`;
}

function circleMemberId(member: CircleMember) {
  return `${member.bucket}:${member.source}:${member.address}`;
}

function buildCleanupAction(row: RelationRow): CleanupAction {
  return {
    id: cleanupRowId(row),
    targetAddress: row.address,
    reason: "outgoing-only",
    method: "removeTrust",
  };
}

function trustBand(signal?: TrustSignal | null): TrustBand {
  if (!signal || signal.trustScore === null) return "unknown";
  if (signal.trustScore >= 70) return "strong";
  if (signal.trustScore >= 40) return "medium";
  return "low";
}

function trustBandTone(band: TrustBand) {
  if (band === "strong") {
    return "border-sage/25 bg-sage/10 text-sage";
  }
  if (band === "medium") {
    return "border-amber/25 bg-amber/10 text-amber";
  }
  if (band === "low") {
    return "border-citrus/25 bg-citrus/10 text-citrus";
  }
  return "border-ink/10 bg-sand/70 text-ink/60";
}

function scoreLabel(signal?: TrustSignal | null) {
  if (!signal || signal.trustScore === null) return "No score";
  const level = signal.trustLevel?.replace(/^trust\s+/i, "");
  return signal.trustLevel
    ? `${signal.trustScore} / ${level}`
    : `${signal.trustScore}`;
}

function cleanupPriority(signal?: TrustSignal | null) {
  const band = trustBand(signal);
  if (band === "low") return 0;
  if (band === "unknown") return 1;
  if (band === "medium") return 2;
  return 3;
}

function cleanupReason(signal?: TrustSignal | null) {
  const band = trustBand(signal);
  if (band === "low") return "Likely untrust";
  if (band === "medium") return "Medium trust";
  if (band === "strong") return "Strong trust";
  return "Unknown trust";
}

function cleanupHint(signal?: TrustSignal | null) {
  const band = trustBand(signal);
  if (band === "low") return "Review priority";
  if (band === "medium") return "Check context";
  if (band === "strong") return "Untrust with caution";
  return "Manual review";
}

function decisionToneClass(tone: "amber" | "citrus" | "marine" | "sage") {
  if (tone === "sage") return "border-sage/25 bg-sage/10 text-sage";
  if (tone === "amber") return "border-amber/25 bg-amber/10 text-amber";
  if (tone === "citrus") return "border-citrus/25 bg-citrus/10 text-citrus";
  return "border-marine/20 bg-marine/10 text-marine";
}

function planDecisionLabel(decision: PlanDecision) {
  if (decision === "confirm") return "Confirm untrust";
  if (decision === "later") return "Review later";
  return "Keep";
}

function planDecisionHelper(decision: PlanDecision) {
  if (decision === "confirm") return "Ready for the signature step.";
  if (decision === "later") return "Keep it in the plan, without signing now.";
  return "Do not sign this one; remove it from the plan if confirmed.";
}

function planDecisionTone(decision: PlanDecision) {
  if (decision === "confirm") return "border-citrus/25 bg-citrus/10 text-citrus";
  if (decision === "later") return "border-amber/25 bg-amber/10 text-amber";
  return "border-sage/25 bg-sage/10 text-sage";
}

function accountAgeLabel(signal?: TrustSignal | null) {
  if (!signal) return "Unknown";
  if (signal.ageDays <= 0) return "Unknown";
  if (signal.ageDays < 30) return `${signal.ageDays}d - recent`;
  if (signal.ageDays < 180) return `${signal.ageDays}d`;
  return `${signal.ageDays}d - old`;
}

function networkLabel(signal?: TrustSignal | null) {
  if (!signal) return "Unknown";
  return `${signal.mutualCount} mutual / ${signal.inDegree} in / ${signal.outDegree} out`;
}

function cleanerStatus(
  member: CircleMember,
  signal?: TrustSignal | null,
  profile?: CirclesProfile | null,
) {
  const band = trustBand(signal);
  const identifiable = Boolean(profile?.name?.trim() || profile?.imageUrl);
  const accountType = profileTypeLabel(profile);

  if (member.bucket === "keep") {
    return {
      label: "Keep",
      reasons: ["Direct mutual trust", `Type: ${accountType}`, networkLabel(signal)],
      summary:
        "Mutual relation: it should not be suggested as an automatic untrust.",
      tone: "sage" as const,
    };
  }

  if (member.bucket === "incoming") {
    return {
      label: "No outgoing risk",
      reasons: [
        "This profile trusts you",
        `Type: ${accountType}`,
        "You do not accept their CRC in your economy",
      ],
      summary:
        "Incoming-only relation: it does not create an outgoing commitment for you.",
      tone: "marine" as const,
    };
  }

  const weakSignals = [
    band === "low" || band === "unknown" ? "low or unknown trust" : null,
    signal?.backerStatus === "none" ? "not a direct backer" : null,
    signal?.backerStatus === "unknown" ? "unknown backer status" : null,
    signal && signal.ageDays > 0 && signal.ageDays < 30 ? "recent account" : null,
    signal && signal.inDegree === 0 && signal.outDegree === 0 ? "empty network" : null,
    !identifiable ? "low-identifiability profile" : null,
  ].filter(Boolean) as string[];
  const contextSignals = [`Type: ${accountType}`, scoreLabel(signal), accountAgeLabel(signal)];

  if (weakSignals.length >= 3) {
    return {
      label: "Urgent",
      reasons: weakSignals,
      summary:
        "Outgoing-only trust with several weak signals. Review first for untrust.",
      tone: "citrus" as const,
    };
  }

  if (weakSignals.length >= 2 || band === "low" || band === "unknown") {
    return {
      label: "Likely untrust",
      reasons: weakSignals.length ? weakSignals : ["incomplete signals"],
      summary:
        "Outgoing-only trust with weak signals. Natural candidate to review for untrust.",
      tone: "amber" as const,
    };
  }

  return {
    label: "Review",
    reasons: ["outgoing-only trust", ...contextSignals],
    summary:
      "Outgoing-only trust with mixed signals. The decision remains manual.",
    tone: "amber" as const,
  };
}

function cleanerReviewScore(
  member: CircleMember,
  signal?: TrustSignal | null,
  profile?: CirclesProfile | null,
) {
  if (member.bucket !== "review") return 0;

  const band = trustBand(signal);
  const identifiable = Boolean(profile?.name?.trim() || profile?.imageUrl);
  let score = 25;

  if (band === "low") score += 35;
  else if (band === "unknown") score += 30;
  else if (band === "medium") score += 15;
  else score += 4;

  if (!signal) score += 12;
  else {
    if (signal.backerStatus === "none") score += 18;
    if (signal.backerStatus === "unknown") score += 8;
    if (signal.backerStatus === "direct") score -= 8;
    if (signal.ageDays > 0 && signal.ageDays < 30) score += 12;
    if (signal.ageDays === 0) score += 6;
    if (signal.mutualCount === 0) score += 8;
    if (signal.inDegree === 0 && signal.outDegree === 0) score += 10;
  }

  if (!identifiable) score += 8;
  return Math.max(0, score);
}

function circleBucketLabel(bucket: CircleBucket) {
  if (bucket === "keep") return "Mutual";
  if (bucket === "review") return "Outgoing-only trust";
  return "Incoming-only trust";
}

function circleBucketTone(bucket: CircleBucket) {
  if (bucket === "keep") return "border-sage/25 bg-sage/10 text-sage";
  if (bucket === "review") return "border-citrus/25 bg-citrus/10 text-citrus";
  return "border-marine/20 bg-marine/10 text-marine";
}

function relationSentence(member: CircleMember, name: string) {
  if (member.bucket === "keep") {
    return "Mutual trust: you each accept the other's CRC.";
  }
  if (member.bucket === "review") {
    return `You accept ${name}'s CRC, with no direct trust back detected.`;
  }
  return `${name} accepts your CRC; you do not take outgoing risk.`;
}

function hasPositiveFlow(value: string) {
  try {
    return BigInt(value) > 0n;
  } catch {
    return false;
  }
}

function profileTypeLabel(profile?: CirclesProfile | null) {
  const explicit = profile?.typeLabel?.trim();
  if (explicit) return explicit;

  const avatarType = profile?.avatarType?.toLowerCase() ?? "";
  if (avatarType.includes("group")) return "Group";
  if (avatarType.includes("org")) return "Org";
  if (avatarType.includes("human") || avatarType.includes("person")) {
    return "User";
  }
  if (profile?.name?.trim()) return "Profile";
  return "Crypto address";
}

function collectPathfinderAddresses(
  pathfinder: PathfinderState,
  addresses: Set<string>,
) {
  if (pathfinder.status !== "ready") return;
  const from = normalizeAddress(pathfinder.preview.from);
  const to = normalizeAddress(pathfinder.preview.to);
  if (from) addresses.add(from);
  if (to) addresses.add(to);

  for (const transfer of pathfinder.preview.transfers.slice(
    0,
    FLOW_GRAPH_TRANSFER_LIMIT,
  )) {
    for (const value of [transfer.from, transfer.to, transfer.tokenOwner]) {
      const normalized = normalizeAddress(value);
      if (normalized) addresses.add(normalized);
    }
  }
}

function buildTrustDecision(
  member: CircleMember,
  signal: TrustSignal | null | undefined,
  name: string,
) {
  const band = trustBand(signal);
  const score = scoreLabel(signal);
  const mutuals = signal?.mutualCount ?? 0;
  const network = signal ? `${signal.inDegree} in / ${signal.outDegree} out` : "network loading";

  if (member.bucket === "keep") {
    return {
      action: "No untrust recommended.",
      factors: [
        "Direct bidirectional relation",
        `${mutuals} mutuals detected`,
        `Network: ${network}`,
      ],
      label: "Keep",
      summary:
        "This mutual trust helps CRC circulation. Keep it unless the social relation is no longer reliable.",
      tone: "sage" as const,
    };
  }

  if (member.bucket === "incoming") {
    return {
      action: "No outgoing action: you do not trust this profile.",
      factors: [
        `${name} accepts your CRC`,
        "No outgoing commitment from you",
        `Observed score: ${score}`,
      ],
      label: "No action",
      summary:
        "This relation can help reception toward you without making you accept their CRC.",
      tone: "marine" as const,
    };
  }

  const urgent = band === "low" || band === "unknown";
  return {
    action: "Check whether you really know this profile and want to accept their CRC.",
    factors: [
      "Active outgoing commitment",
      "No direct trust back",
      `Observed score: ${score}`,
    ],
    label: urgent ? "Priority review" : "Review context",
    summary:
      "You accept their CRC in your economy. Without direct trust back, this trust should be intentional and justified.",
    tone: urgent ? ("citrus" as const) : ("amber" as const),
  };
}

function CountTile({
  icon,
  info,
  label,
  tone = "marine",
  value,
}: {
  icon: ReactNode;
  info?: string;
  label: string;
  tone?: "marine" | "citrus" | "sage" | "amber" | "ink";
  value: number | string;
}) {
  const compactValue = typeof value === "string" && value.length > 6;
  const toneStyle = {
    amber: { backgroundColor: "rgba(173, 109, 47, 0.15)", color: "#ad6d2f" },
    citrus: { backgroundColor: "rgba(255, 73, 27, 0.1)", color: "#ff491b" },
    ink: { backgroundColor: "rgba(27, 27, 31, 0.1)", color: "#1b1b1f" },
    marine: { backgroundColor: "rgba(37, 27, 159, 0.1)", color: "#251b9f" },
    sage: { backgroundColor: "rgba(93, 125, 68, 0.15)", color: "#5d7d44" },
  }[tone];

  return (
    <div className="trust-panel-soft rounded-lg p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink/55">
          <span className="truncate">{label}</span>
          {info ? (
            <span
              aria-label={info}
              className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-ink/10 bg-white/60 text-ink/45"
              title={info}
            >
              <Info className="size-3" />
            </span>
          ) : null}
        </span>
        <span className="rounded-md p-1.5" style={toneStyle}>{icon}</span>
      </div>
      <div
        className={
          compactValue
            ? "mt-2 break-words text-sm font-semibold tabular-nums text-ink"
            : "mt-2 text-3xl font-semibold tabular-nums text-ink"
        }
      >
        {value}
      </div>
    </div>
  );
}

function ProfileAvatar({
  address,
  profile,
  size = "sm",
}: {
  address: string;
  profile?: CirclesProfile | null;
  size?: "sm" | "md";
}) {
  const displayName = profile?.name?.trim() || shortenAddress(address);
  const sizeClass = size === "md" ? "size-11" : "size-9";
  const letterClass = size === "md" ? "text-base" : "text-sm";

  return (
    <span
      className={`${sizeClass} inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-ink/10 bg-marine/10 font-semibold text-marine shadow-sm`}
    >
      {profile?.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={profile.imageUrl}
          alt={displayName}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <span className={letterClass}>{displayName.slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  );
}

function TrustSignalBadge({
  signal,
  compact = false,
}: {
  signal?: TrustSignal | null;
  compact?: boolean;
}) {
  const band = trustBand(signal);
  const label = compact ? scoreLabel(signal).replace("Trust ", "") : scoreLabel(signal);

  return (
    <Badge className={trustBandTone(band)} variant="outline">
      {label}
    </Badge>
  );
}

function TrustSignalMeta({ signal }: { signal?: TrustSignal | null }) {
  if (!signal) {
    return <span>Score loading</span>;
  }

  return (
    <span>
      {signal.mutualCount} mutual - {signal.inDegree} in / {signal.outDegree} out
    </span>
  );
}

function ProfileIdentity({
  address,
  profile,
  signal,
}: {
  address: string;
  profile?: CirclesProfile | null;
  signal?: TrustSignal | null;
}) {
  const name = profile?.name?.trim();
  const type = profileTypeLabel(profile);

  return (
    <div className="mt-3 flex min-w-0 items-center gap-3 rounded-lg border border-ink/10 bg-white/45 px-3 py-2">
      <ProfileAvatar address={address} profile={profile} size="md" />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-ink">
          {name || "Circles profile"}
        </div>
        <div className="truncate text-xs text-ink/55">
          {shortenAddress(address)} - {type} - <TrustSignalMeta signal={signal} />
        </div>
      </div>
      <div className="ml-auto hidden shrink-0 items-center gap-2 sm:flex">
        <Badge className="border-ink/10 bg-sand/70 text-ink/60" variant="outline">
          {type}
        </Badge>
        <TrustSignalBadge signal={signal} />
      </div>
    </div>
  );
}

function RelationList({
  empty,
  profiles,
  rows,
  tone,
  trustSignals,
}: {
  empty: string;
  profiles: Record<string, CirclesProfile>;
  rows: RelationRow[];
  tone: "marine" | "citrus" | "sage" | "amber";
  trustSignals: Record<string, TrustSignal>;
}) {
  const toneClasses = {
    amber: "border-amber/20 bg-amber/10 text-amber",
    citrus: "border-citrus/25 bg-citrus/10 text-citrus",
    marine: "border-marine/20 bg-marine/10 text-marine",
    sage: "border-sage/20 bg-sage/10 text-sage",
  }[tone];

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-ink/15 bg-white/35 p-3 text-sm text-ink/55">
        {empty}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.slice(0, 5).map((row) => (
        <div
          key={`${row.source}-${row.address}`}
          className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white/55 px-3 py-2"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <ProfileAvatar
              address={row.address}
              profile={profiles[row.address]}
            />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink">
                {profiles[row.address]?.name?.trim() || shortenAddress(row.address)}
              </div>
              <div className="truncate text-xs text-ink/55">
                {row.timestamp
                  ? `${shortenAddress(row.address)} - ${row.label} - ${row.timestamp}`
                  : `${shortenAddress(row.address)} - ${row.label}`}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            <TrustSignalBadge signal={trustSignals[row.address]} compact />
            <Badge className={toneClasses} variant="outline">
              dry-run
            </Badge>
          </div>
        </div>
      ))}
      {rows.length > 5 ? (
        <div className="text-xs font-medium text-ink/50">
          +{rows.length - 5} more in raw data
        </div>
      ) : null}
    </div>
  );
}

function AnalysisColumn({
  count,
  description,
  empty,
  icon,
  profiles,
  rows,
  title,
  tone,
  trustSignals,
}: {
  count: number;
  description: string;
  empty: string;
  icon: ReactNode;
  profiles: Record<string, CirclesProfile>;
  rows: RelationRow[];
  title: string;
  tone: "marine" | "citrus" | "sage" | "amber";
  trustSignals: Record<string, TrustSignal>;
}) {
  const toneStyle = {
    amber: { backgroundColor: "rgba(173, 109, 47, 0.15)", color: "#ad6d2f" },
    citrus: { backgroundColor: "rgba(255, 73, 27, 0.1)", color: "#ff491b" },
    marine: { backgroundColor: "rgba(37, 27, 159, 0.1)", color: "#251b9f" },
    sage: { backgroundColor: "rgba(93, 125, 68, 0.15)", color: "#5d7d44" },
  }[tone];

  return (
    <div className="rounded-lg border border-ink/10 bg-white/45 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-ink/60">
            {description}
          </p>
        </div>
        <span className="rounded-md p-1.5" style={toneStyle}>
          {icon}
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <span className="text-3xl font-semibold tabular-nums text-ink">
          {count}
        </span>
        <Badge className="border-ink/10 bg-sand/70 text-ink/65" variant="outline">
          read-only
        </Badge>
      </div>
      <div className="mt-3">
        <RelationList
          empty={empty}
          profiles={profiles}
          rows={rows}
          tone={tone}
          trustSignals={trustSignals}
        />
      </div>
    </div>
  );
}

function CleanerAnalysisPanel({
  analysis,
  profiles,
  trustSignals,
}: {
  analysis: CleanerAnalysis;
  profiles: Record<string, CirclesProfile>;
  trustSignals: Record<string, TrustSignal>;
}) {
  return (
    <section className="trust-panel rounded-lg p-4 sm:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-ink">
              Cleaner analysis
            </h2>
            <Badge className="border-marine/20 bg-marine/10 text-marine" variant="outline">
              Dry run
            </Badge>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-ink/65">
            Read-only segmentation of the trust graph before any cleaning action.
          </p>
        </div>
        <div className="rounded-lg border border-ink/10 bg-white/50 px-3 py-2 text-sm font-medium text-ink/70">
          {analysis.recommendation}
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <AnalysisColumn
          count={analysis.outgoingOnly.length}
          description="People this wallet trusts without a mutual relation."
          empty="No outgoing-only trust detected in the loaded lists."
          icon={<ListChecks className="size-4" />}
          profiles={profiles}
          rows={analysis.outgoingOnly}
          title="Review first"
          tone="citrus"
          trustSignals={trustSignals}
        />
        <AnalysisColumn
          count={analysis.mutual.length}
          description="Bidirectional trust relations, usually the safest keep set."
          empty="No mutual trust detected yet."
          icon={<CheckCircle2 className="size-4" />}
          profiles={profiles}
          rows={analysis.mutual}
          title="Keep set"
          tone="sage"
          trustSignals={trustSignals}
        />
        <AnalysisColumn
          count={analysis.incomingOnly.length}
          description="People who trust this wallet without a returned trust."
          empty="No incoming-only trust detected in the loaded lists."
          icon={<Eye className="size-4" />}
          profiles={profiles}
          rows={analysis.incomingOnly}
          title="Incoming only"
          tone="marine"
          trustSignals={trustSignals}
        />
      </div>

      <div className="mt-3 rounded-lg border border-ink/10 bg-white/35 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Raw relation sample</h3>
            <p className="mt-1 text-xs text-ink/60">
              First normalized counterparts from the latest raw page.
            </p>
          </div>
          <Badge className="border-amber/20 bg-amber/10 text-amber" variant="outline">
            {analysis.rawSample.length}
          </Badge>
        </div>
        <div className="mt-3">
          <RelationList
            empty="No raw counterpart extracted yet."
            profiles={profiles}
            rows={analysis.rawSample}
            tone="amber"
            trustSignals={trustSignals}
          />
        </div>
      </div>
    </section>
  );
}

function CriteriaPanel({
  candidates,
  trustSignals,
}: {
  candidates: RelationRow[];
  trustSignals: Record<string, TrustSignal>;
}) {
  const summary = candidates.reduce(
    (acc, row) => {
      acc[trustBand(trustSignals[row.address])] += 1;
      const score = trustSignals[row.address]?.trustScore;
      if (typeof score === "number") {
        acc.scoreTotal += score;
        acc.scored += 1;
      }
      return acc;
    },
    { low: 0, medium: 0, scored: 0, scoreTotal: 0, strong: 0, unknown: 0 },
  );
  const averageScore =
    summary.scored > 0 ? Math.round(summary.scoreTotal / summary.scored) : null;

  return (
    <section className="trust-panel rounded-lg p-4 sm:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-ink">
              Decision criteria
            </h2>
            <Badge className="border-marine/20 bg-marine/10 text-marine" variant="outline">
              Member signals
            </Badge>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-ink/65">
            Relation type is the primary signal. Member score changes priority,
            not ownership or final action.
          </p>
        </div>
        <div className="rounded-lg border border-ink/10 bg-white/50 px-3 py-2 text-sm font-semibold text-ink">
          {averageScore === null ? "No scored candidates" : `Average trust ${averageScore}`}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-ink/10 bg-white/45 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <ListChecks className="size-4 text-citrus" />
            Relation
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink/60">
            Outgoing-only relations become cleanup candidates. Mutual relations
            stay in the keep set.
          </p>
        </div>
        <div className="rounded-lg border border-ink/10 bg-white/45 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Gauge className="size-4 text-marine" />
            Trust score
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink/60">
            Low scores move higher in the plan. Strong scores add caution before
            removing.
          </p>
        </div>
        <div className="rounded-lg border border-ink/10 bg-white/45 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <UsersRound className="size-4 text-sage" />
            Network shape
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink/60">
            In degree, out degree, mutual count and account age stay visible on
            every member.
          </p>
        </div>
        <div className="rounded-lg border border-ink/10 bg-white/45 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <ShieldAlert className="size-4 text-amber" />
            Manual gate
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink/60">
            No member is selected automatically. Every removal remains a human
            choice.
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Badge className={trustBandTone("low")} variant="outline">
          {summary.low} low
        </Badge>
        <Badge className={trustBandTone("unknown")} variant="outline">
          {summary.unknown} unknown
        </Badge>
        <Badge className={trustBandTone("medium")} variant="outline">
          {summary.medium} medium
        </Badge>
        <Badge className={trustBandTone("strong")} variant="outline">
          {summary.strong} strong
        </Badge>
      </div>
    </section>
  );
}

function CleanupPlanPanel({
  candidates,
  onClear,
  onPrepare,
  onSelectAll,
  onToggle,
  previewOpen,
  profiles,
  selectedIds,
  trustSignals,
}: {
  candidates: RelationRow[];
  onClear: () => void;
  onPrepare: () => void;
  onSelectAll: () => void;
  onToggle: (id: string) => void;
  previewOpen: boolean;
  profiles: Record<string, CirclesProfile>;
  selectedIds: Set<string>;
  trustSignals: Record<string, TrustSignal>;
}) {
  const selectedRows = candidates.filter((row) =>
    selectedIds.has(cleanupRowId(row)),
  );
  const selectedActions = selectedRows.map(buildCleanupAction);
  const hasCandidates = candidates.length > 0;
  const hasSelection = selectedRows.length > 0;

  return (
    <section className="trust-panel rounded-lg p-4 sm:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-ink">
              Untrust plan
            </h2>
            <Badge className="border-citrus/25 bg-citrus/10 text-citrus" variant="outline">
              Dry run only
            </Badge>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-ink/65">
            Select outgoing-only trusts to prepare for untrust.
          </p>
        </div>
        <div className="rounded-lg border border-ink/10 bg-white/50 px-3 py-2 text-sm font-semibold text-ink">
          {selectedRows.length} selected / {candidates.length} candidates
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-ink/10 bg-white/35 p-3">
        {!hasCandidates ? (
          <div className="flex flex-col gap-2 rounded-lg border border-dashed border-ink/15 bg-white/40 p-4 text-sm text-ink/60">
            <span className="font-semibold text-ink">No untrust candidate.</span>
            <span>
              This wallet has no outgoing-only trust in the loaded SDK lists, so
              Trust Cleaner does not suggest any untrust.
            </span>
          </div>
        ) : (
          <div className="space-y-2">
            {candidates.map((row) => {
              const id = cleanupRowId(row);
              const selected = selectedIds.has(id);
              const profile = profiles[row.address];
              const signal = trustSignals[row.address];
              const name = profile?.name?.trim() || shortenAddress(row.address);

              return (
                <label
                  key={id}
                  className={
                    "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition " +
                    (selected
                      ? "border-citrus/35 bg-citrus/10"
                      : "border-ink/10 bg-white/55 hover:border-marine/25")
                  }
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggle(id)}
                    className="size-4 shrink-0 accent-[#251b9f]"
                    aria-label={`Select untrust for ${name}`}
                  />
                  <ProfileAvatar address={row.address} profile={profile} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-ink">
                      {name}
                    </div>
                    <div className="truncate text-xs text-ink/55">
                      {shortenAddress(row.address)} - {cleanupHint(signal)} -{" "}
                      <TrustSignalMeta signal={signal} />
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                    <TrustSignalBadge signal={signal} compact />
                    <Badge className="border-citrus/25 bg-citrus/10 text-citrus" variant="outline">
                      outgoing-only
                    </Badge>
                  </div>
                </label>
              );
            })}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="border-ink/15 bg-white/70 hover:border-marine/30 hover:bg-white"
            disabled={!hasCandidates || selectedRows.length === candidates.length}
            onClick={onSelectAll}
          >
            Select all
          </Button>
          <Button
            type="button"
            variant="outline"
            className="border-ink/15 bg-white/70 hover:border-citrus/30 hover:bg-white"
            disabled={!hasSelection}
            onClick={onClear}
          >
            Clear
          </Button>
          <Button
            type="button"
            disabled={!hasSelection}
            onClick={onPrepare}
          >
            <ClipboardCheck className="size-4" />
            Prepare plan
          </Button>
        </div>
      </div>

      {previewOpen && hasSelection ? (
        <div className="mt-3 rounded-lg border border-marine/15 bg-marine/5 p-3">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-marine/10 p-1.5 text-marine">
              <Trash2 className="size-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-ink">
                Prepared actions
              </h3>
              <p className="text-xs text-ink/60">
                Preview only. No transaction has been sent.
              </p>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {selectedActions.map((action) => {
              const profile = profiles[action.targetAddress];
              const signal = trustSignals[action.targetAddress];
              const name =
                profile?.name?.trim() || shortenAddress(action.targetAddress);

              return (
                <div
                  key={action.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white/60 px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <ProfileAvatar
                      address={action.targetAddress}
                      profile={profile}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ink">
                        {name}
                      </div>
                      <div className="truncate text-xs text-ink/55">
                        {shortenAddress(action.targetAddress)} -{" "}
                        {action.method}
                      </div>
                    </div>
                  </div>
                  <Badge className="border-marine/20 bg-marine/10 text-marine" variant="outline">
                    {cleanupReason(signal)}
                  </Badge>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function CirclePersonCard({
  member,
  onSelect,
  onToggleCleanup,
  profile,
  selected,
  signal,
  cleanupSelected,
}: {
  member: CircleMember;
  onSelect: () => void;
  onToggleCleanup: () => void;
  profile?: CirclesProfile | null;
  selected: boolean;
  signal?: TrustSignal | null;
  cleanupSelected: boolean;
}) {
  const name = profile?.name?.trim() || shortenAddress(member.address);
  const isReview = member.bucket === "review";
  const status = cleanerStatus(member, signal, profile);
  const type = profileTypeLabel(profile);

  return (
    <div
      className={
        "rounded-lg border bg-white/60 p-3 transition " +
        (selected ? "border-marine/40 shadow-sm" : "border-ink/10")
      }
    >
      <div className="flex items-start gap-3">
        {isReview ? (
          <input
            type="checkbox"
            checked={cleanupSelected}
            onChange={onToggleCleanup}
            className="mt-3 size-4 shrink-0 accent-[#251b9f]"
            aria-label={`Add ${name} to the untrust plan`}
          />
        ) : null}
        <ProfileAvatar address={member.address} profile={profile} />
        <button
          type="button"
          onClick={onSelect}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink">
                {name}
              </div>
              <div className="truncate text-xs text-ink/55">
                {shortenAddress(member.address)} - {type}
              </div>
            </div>
            <Badge className={decisionToneClass(status.tone)} variant="outline">
              {status.label}
            </Badge>
          </div>
          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-ink/65">
            {relationSentence(member, name)}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge className={circleBucketTone(member.bucket)} variant="outline">
              {circleBucketLabel(member.bucket)}
            </Badge>
            <Badge className="border-ink/10 bg-sand/70 text-ink/60" variant="outline">
              {type}
            </Badge>
            <Badge className={trustBandTone(trustBand(signal))} variant="outline">
              Score {scoreLabel(signal)}
            </Badge>
            {isReview ? (
              <Badge className="border-ink/10 bg-sand/70 text-ink/60" variant="outline">
                Backer {backerLabel(signal)}
              </Badge>
            ) : null}
          </div>
          {isReview ? (
            <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px] text-ink/55">
              <span className="truncate rounded-md bg-sand/60 px-2 py-1">
                Age {accountAgeLabel(signal)}
              </span>
              <span className="truncate rounded-md bg-sand/60 px-2 py-1">
                {networkLabel(signal)}
              </span>
            </div>
          ) : null}
        </button>
      </div>
    </div>
  );
}

function CircleColumn({
  empty,
  members,
  onSelect,
  onToggleCleanup,
  profiles,
  selectedCleanupIds,
  selectedMemberId,
  title,
  trustSignals,
}: {
  empty: string;
  members: CircleMember[];
  onSelect: (member: CircleMember) => void;
  onToggleCleanup: (id: string) => void;
  profiles: Record<string, CirclesProfile>;
  selectedCleanupIds: Set<string>;
  selectedMemberId: string | null;
  title: string;
  trustSignals: Record<string, TrustSignal>;
}) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white/35 p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <Badge className="border-ink/10 bg-sand/70 text-ink/65" variant="outline">
          {members.length}
        </Badge>
      </div>
      <div className="mt-3 space-y-2">
        {members.length === 0 ? (
          <div className="rounded-lg border border-dashed border-ink/15 bg-white/35 p-3 text-sm text-ink/55">
            {empty}
          </div>
        ) : (
          members.map((member) => (
            <CirclePersonCard
              key={circleMemberId(member)}
              cleanupSelected={selectedCleanupIds.has(cleanupRowId(member))}
              member={member}
              onSelect={() => onSelect(member)}
              onToggleCleanup={() => onToggleCleanup(cleanupRowId(member))}
              profile={profiles[member.address]}
              selected={selectedMemberId === circleMemberId(member)}
              signal={trustSignals[member.address]}
            />
          ))
        )}
      </div>
    </div>
  );
}

function FlowAddressChip({
  address,
  profiles,
}: {
  address: string;
  profiles: Record<string, CirclesProfile>;
}) {
  const normalized = normalizeAddress(address) ?? address.toLowerCase();
  const profile = profiles[normalized];
  const name = profile?.name?.trim();

  return (
    <span className="flex min-w-0 items-center gap-2 rounded-md border border-ink/10 bg-white/65 px-2 py-1.5">
      <ProfileAvatar address={normalized} profile={profile} />
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold text-ink">
          {name || shortenAddress(normalized)}
        </span>
        <span className="block truncate font-mono text-[11px] text-ink/45">
          {name ? shortenAddress(normalized) : profileTypeLabel(profile)}
        </span>
      </span>
      <Badge
        className="ml-auto shrink-0 border-ink/10 bg-sand/70 text-[10px] text-ink/55"
        variant="outline"
      >
        {profileTypeLabel(profile)}
      </Badge>
    </span>
  );
}

function parseAttoCrc(value: string) {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function formatAttoCrcShort(value: bigint, decimals = 3) {
  const unit = 10n ** 18n;
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / unit;
  const fraction = absolute % unit;
  const fractionText = fraction
    .toString()
    .padStart(18, "0")
    .slice(0, decimals);
  const trimmed = fractionText.replace(/0+$/, "");
  return `${sign}${whole.toString()}${trimmed ? `.${trimmed}` : ""}`;
}

function crcNumber(value: bigint) {
  return Number(value / 10n ** 12n) / 1_000_000;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function compactGraphLabel(value: string) {
  return value.length > 17 ? `${value.slice(0, 15)}...` : value;
}

function graphNodeLabel(
  address: string,
  profiles: Record<string, CirclesProfile>,
) {
  return profiles[address]?.name?.trim() || shortenAddress(address);
}

function backerLabel(signal?: TrustSignal | null) {
  if (!signal) return "Unknown";
  if (signal.backerStatus === "direct") return "Direct";
  if (signal.backerStatus === "none") return "No";
  return "Unknown";
}

function graphRelationLabel({
  address,
  member,
  sourceAddress,
}: {
  address: string;
  member?: CircleMember | null;
  sourceAddress: string | null;
}) {
  const normalizedSource = sourceAddress?.toLowerCase() ?? "";
  if (normalizedSource && address === normalizedSource) return "Loaded address";
  if (!member) return "Outside loaded circle";
  if (member.bucket === "keep") return "Mutual trust";
  if (member.bucket === "review") return "You trust, non-mutual";
  return "Trusts you, non-mutual";
}

function graphProfileResult(
  address: string,
  profiles: Record<string, CirclesProfile>,
): ProfileSearchResult {
  const normalized = normalizeAddress(address) ?? address.toLowerCase();
  const profile = profiles[normalized];
  return {
    address: normalized,
    imageUrl: profile?.imageUrl ?? null,
    name: profile?.name?.trim() || shortenAddress(normalized),
  };
}

function graphPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  id: string,
  index: number,
) {
  const dx = Math.max(80, Math.abs(to.x - from.x));
  const baseCurve = (stableHash(id) - 0.5) * 90;
  const duplicateCurve = ((index % 5) - 2) * 8;
  const curve = baseCurve + duplicateCurve;
  return `M ${from.x} ${from.y} C ${from.x + dx * 0.42} ${
    from.y + curve
  } ${to.x - dx * 0.42} ${to.y - curve} ${to.x} ${to.y}`;
}

type NativeFullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

type NativeFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function nativeFullscreenElement() {
  const fullscreenDocument = document as NativeFullscreenDocument;
  return (
    document.fullscreenElement ??
    fullscreenDocument.webkitFullscreenElement ??
    null
  );
}

function requestNativeFullscreen(element: HTMLElement) {
  if (nativeFullscreenElement()) return;

  const fullscreenElement = element as NativeFullscreenElement;
  const request =
    fullscreenElement.requestFullscreen ??
    fullscreenElement.webkitRequestFullscreen;
  if (!request) return;

  const result = request.call(fullscreenElement);
  if (result && typeof result.catch === "function") {
    void result.catch(() => undefined);
  }
}

function exitNativeFullscreen() {
  if (!nativeFullscreenElement()) return;

  const fullscreenDocument = document as NativeFullscreenDocument;
  const exit =
    document.exitFullscreen ?? fullscreenDocument.webkitExitFullscreen;
  if (!exit) return;

  const result = exit.call(document);
  if (result && typeof result.catch === "function") {
    void result.catch(() => undefined);
  }
}

function FullscreenGraphPortal({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  if (!active || typeof document === "undefined") {
    return <>{children}</>;
  }

  return createPortal(children, document.body);
}

function buildFlowGraph(
  preview: PathfinderPreview,
  profiles: Record<string, CirclesProfile>,
) {
  const transfers = preview.transfers.slice(0, FLOW_GRAPH_TRANSFER_LIMIT);
  const source = normalizeAddress(preview.from) ?? preview.from.toLowerCase();
  const target = normalizeAddress(preview.to) ?? preview.to.toLowerCase();
  const nodeAddresses = new Set<string>([source, target]);
  const edgeMap = new Map<
    string,
    {
      count: number;
      from: string;
      tokenOwners: Set<string>;
      to: string;
      value: bigint;
    }
  >();
  const degree = new Map<string, bigint>();

  for (const transfer of transfers) {
    const from = normalizeAddress(transfer.from) ?? transfer.from.toLowerCase();
    const to = normalizeAddress(transfer.to) ?? transfer.to.toLowerCase();
    const tokenOwner =
      normalizeAddress(transfer.tokenOwner) ?? transfer.tokenOwner.toLowerCase();
    const value = parseAttoCrc(transfer.value);
    const edgeKey = `${from}:${to}`;

    nodeAddresses.add(from);
    nodeAddresses.add(to);
    if (!edgeMap.has(edgeKey)) {
      edgeMap.set(edgeKey, {
        count: 0,
        from,
        tokenOwners: new Set<string>(),
        to,
        value: 0n,
      });
    }
    const edge = edgeMap.get(edgeKey);
    if (!edge) continue;
    edge.count += 1;
    edge.tokenOwners.add(tokenOwner);
    edge.value += value;
    degree.set(from, (degree.get(from) ?? 0n) + value);
    degree.set(to, (degree.get(to) ?? 0n) + value);
  }

  const depth = new Map<string, number>([[source, 0]]);
  for (let pass = 0; pass < 8; pass += 1) {
    for (const edge of edgeMap.values()) {
      const fromDepth = depth.get(edge.from);
      if (typeof fromDepth !== "number") continue;
      const nextDepth = fromDepth + 1;
      const currentDepth = depth.get(edge.to);
      if (typeof currentDepth !== "number" || nextDepth < currentDepth) {
        depth.set(edge.to, nextDepth);
      }
    }
  }

  const relayAddresses = Array.from(nodeAddresses)
    .filter((address) => address !== source && address !== target)
    .sort((left, right) => (degree.get(right) ?? 0n) > (degree.get(left) ?? 0n) ? 1 : -1);
  const maxDepth = Math.max(
    2,
    ...relayAddresses.map((address) => depth.get(address) ?? 2),
  );
  const groups = new Map<number, string[]>();

  for (const address of relayAddresses) {
    const group = Math.min(Math.max(depth.get(address) ?? 2, 1), maxDepth);
    groups.set(group, [...(groups.get(group) ?? []), address]);
  }

  const nodeMap = new Map<
    string,
    {
      address: string;
      kind: "source" | "target" | "relay";
      label: string;
      r: number;
      showLabel: boolean;
      x: number;
      y: number;
    }
  >();
  const ranked = [...relayAddresses]
    .sort((left, right) => (degree.get(right) ?? 0n) > (degree.get(left) ?? 0n) ? 1 : -1)
    .slice(0, 14);
  const showAllLabels = relayAddresses.length <= 24;

  nodeMap.set(source, {
    address: source,
    kind: "source",
    label: graphNodeLabel(source, profiles),
    r: 18,
    showLabel: true,
    x: 100,
    y: 280,
  });
  nodeMap.set(target, {
    address: target,
    kind: "target",
    label: graphNodeLabel(target, profiles),
    r: 18,
    showLabel: true,
    x: 1100,
    y: 280,
  });

  for (const [group, addresses] of groups) {
    addresses.forEach((address, index) => {
      const count = addresses.length;
      const ratio = maxDepth <= 1 ? 0.5 : group / (maxDepth + 1);
      const jitter = (stableHash(address) - 0.5) * 72;
      const y = 86 + ((index + 1) * 388) / (count + 1);
      const weight = Math.log10(Math.max(1, crcNumber(degree.get(address) ?? 0n)) + 1);
      nodeMap.set(address, {
        address,
        kind: "relay",
        label: graphNodeLabel(address, profiles),
        r: 8 + Math.min(8, weight * 2.2),
        showLabel: showAllLabels || ranked.includes(address),
        x: 210 + ratio * 780 + jitter,
        y,
      });
    });
  }

  const valueLogs = Array.from(edgeMap.values()).map((edge) =>
    Math.log10(Math.max(1, crcNumber(edge.value)) + 1),
  );
  const minLog = Math.min(...valueLogs, 0);
  const maxLog = Math.max(...valueLogs, 1);
  const edges = Array.from(edgeMap.values())
    .sort((left, right) => (right.value > left.value ? 1 : -1))
    .map((edge, index) => {
      const logValue = Math.log10(Math.max(1, crcNumber(edge.value)) + 1);
      const ratio = (logValue - minLog) / Math.max(1, maxLog - minLog);
      return {
        ...edge,
        id: `${edge.from}:${edge.to}:${index}`,
        index,
        label: `${formatAttoCrcShort(edge.value)} CRC`,
        showLabel: index < 6,
        width: 1.2 + ratio * 5.8,
      };
    });

  return {
    edges,
    nodes: Array.from(nodeMap.values()),
    nodeMap,
    truncated: preview.transfers.length > transfers.length,
  };
}

type FlowGraphNode = ReturnType<typeof buildFlowGraph>["nodes"][number];

function FlowGraphNodeCard({
  circleMember,
  node,
  profile,
  signal,
  sourceAddress,
}: {
  circleMember?: CircleMember | null;
  node: FlowGraphNode;
  profile?: CirclesProfile | null;
  signal?: TrustSignal | null;
  sourceAddress: string | null;
}) {
  const width = 276;
  const height = 132;
  const x = node.x > 850 ? node.x - width - node.r - 24 : node.x + node.r + 24;
  const y = Math.min(560 - height - 16, Math.max(16, node.y - height / 2));
  const name = graphNodeLabel(node.address, profile ? { [node.address]: profile } : {});
  const relation = graphRelationLabel({
    address: node.address,
    member: circleMember,
    sourceAddress,
  });
  const backer = backerLabel(signal);
  const score = scoreLabel(signal);
  const type = profileTypeLabel(profile);
  const accent =
    circleMember?.bucket === "keep"
      ? "#9bbf7a"
      : circleMember?.bucket === "review"
        ? "#f05b35"
        : circleMember?.bucket === "incoming"
          ? "#a9a3ff"
          : "#d7d2c5";

  return (
    <g pointerEvents="none" transform={`translate(${x} ${y})`}>
      <rect
        fill="#f8f6ef"
        height={height}
        rx="10"
        stroke={accent}
        strokeOpacity="0.9"
        strokeWidth="2"
        width={width}
      />
      <rect fill={accent} height="4" rx="2" width={width - 24} x="12" y="10" />
      <text fill="#101114" fontSize="15" fontWeight="800" x="16" y="33">
        {compactGraphLabel(name)}
      </text>
      <text fill="#6f6a62" fontFamily="monospace" fontSize="10" x="16" y="50">
        {shortenAddress(node.address)} - {type}
      </text>
      <text fill="#6f6a62" fontSize="10" fontWeight="700" x="16" y="75">
        TRUST SCORE
      </text>
      <text fill="#101114" fontSize="13" fontWeight="750" x="104" y="75">
        {compactGraphLabel(score)}
      </text>
      <text fill="#6f6a62" fontSize="10" fontWeight="700" x="16" y="96">
        BACKER
      </text>
      <text fill="#101114" fontSize="13" fontWeight="750" x="104" y="96">
        {backer}
      </text>
      <text fill="#6f6a62" fontSize="10" fontWeight="700" x="16" y="117">
        RELATION
      </text>
      <text fill="#101114" fontSize="13" fontWeight="750" x="104" y="117">
        {relation}
      </text>
    </g>
  );
}

function FlowRouteGraph({
  circleMembersByAddress,
  onOpenProfile,
  preview,
  profiles,
  sourceAddress,
  trustSignals,
}: {
  circleMembersByAddress: Record<string, CircleMember>;
  onOpenProfile: (profile: ProfileSearchResult) => void;
  preview: PathfinderPreview;
  profiles: Record<string, CirclesProfile>;
  sourceAddress: string | null;
  trustSignals: Record<string, TrustSignal>;
}) {
  const graph = useMemo(
    () => buildFlowGraph(preview, profiles),
    [preview, profiles],
  );
  const [expanded, setExpanded] = useState(false);
  const [activeNodeAddress, setActiveNodeAddress] = useState<string | null>(null);
  const activeNode = activeNodeAddress
    ? graph.nodeMap.get(activeNodeAddress) ?? null
    : null;
  const graphId = useMemo(
    () =>
      `flow-${preview.from.slice(2, 8)}-${preview.to.slice(2, 8)}-${
        preview.transfers.length
      }`,
    [preview.from, preview.to, preview.transfers.length],
  );
  const nodeFill = {
    relay: "#f4f2ec",
    source: "#5d7d44",
    target: "#857be3",
  };
  const graphFrameClass = expanded
    ? "fixed inset-0 z-[100] flex h-[100dvh] w-[100dvw] flex-col overflow-hidden rounded-none border-0 bg-[#101114] text-white shadow-none"
    : "mt-3 cursor-zoom-in overflow-hidden rounded-lg border border-ink/10 bg-[#101114] transition hover:border-marine/35";
  const graphSvgClass = expanded
    ? "min-h-0 w-full flex-1"
    : "h-[520px] w-full";

  useEffect(() => {
    if (!expanded) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function closeWhenNativeFullscreenEnds() {
      if (!nativeFullscreenElement()) setExpanded(false);
    }

    function closeWithEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      setExpanded(false);
      exitNativeFullscreen();
    }

    document.addEventListener("fullscreenchange", closeWhenNativeFullscreenEnds);
    document.addEventListener(
      "webkitfullscreenchange",
      closeWhenNativeFullscreenEnds,
    );
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener(
        "fullscreenchange",
        closeWhenNativeFullscreenEnds,
      );
      document.removeEventListener(
        "webkitfullscreenchange",
        closeWhenNativeFullscreenEnds,
      );
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [expanded]);

  function openExpandedGraph() {
    setExpanded(true);
    requestNativeFullscreen(document.documentElement);
  }

  function closeExpandedGraph() {
    setExpanded(false);
    exitNativeFullscreen();
  }

  function openGraphProfile(address: string) {
    setExpanded(false);
    exitNativeFullscreen();
    onOpenProfile(graphProfileResult(address, profiles));
  }

  function openExpandedGraphWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openExpandedGraph();
  }

  function openNodeWithKeyboard(
    event: KeyboardEvent<SVGGElement>,
    address: string,
  ) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    openGraphProfile(address);
  }

  function openNodeWithPointer(
    event: MouseEvent<SVGGElement>,
    address: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    openGraphProfile(address);
  }

  if (graph.edges.length === 0) return null;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-ink/45">
            Vue graphe
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ink/60">
            Les gros liens portent les plus gros fragments. Les noeuds centraux
            sont les relais qui participent a la route max.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-ink/15 bg-white/70 hover:border-marine/30 hover:bg-white"
            onClick={openExpandedGraph}
          >
            <Maximize2 className="size-3.5" />
            Plein ecran
          </Button>
          <Badge className="border-ink/10 bg-sand/70 text-ink/60" variant="outline">
            {graph.nodes.length} noeuds / {graph.edges.length} liens
          </Badge>
        </div>
      </div>

      {expanded ? (
        <div
          className="fixed inset-0 z-40 bg-ink/70 backdrop-blur-sm"
          onClick={closeExpandedGraph}
        />
      ) : null}

      <FullscreenGraphPortal active={expanded}>
        <div
          data-flow-fullscreen={expanded ? "true" : undefined}
          className={graphFrameClass}
          onClick={expanded ? undefined : openExpandedGraph}
          onKeyDown={expanded ? undefined : openExpandedGraphWithKeyboard}
          role={expanded ? undefined : "button"}
          tabIndex={expanded ? undefined : 0}
        >
          {expanded ? (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#101114]/95 px-4 py-3 text-white">
              <div>
                <div className="text-sm font-semibold">Graphe plein ecran</div>
                <div className="text-xs text-white/55">
                  {graph.nodes.length} noeuds / {graph.edges.length} liens
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-white/20 bg-white/10 text-white hover:bg-white/15"
                onClick={closeExpandedGraph}
              >
                <Minimize2 className="size-3.5" />
                Fermer
              </Button>
            </div>
          ) : null}
          <svg
          aria-label="Graphe des flux Circles"
          className={graphSvgClass}
          role="img"
          viewBox="0 0 1200 560"
        >
          <defs>
            <pattern
              height="28"
              id="flowGrid"
              patternUnits="userSpaceOnUse"
              width="28"
            >
              <circle cx="1" cy="1" fill="#ffffff" opacity="0.12" r="1" />
            </pattern>
          </defs>
          <rect fill="#101114" height="560" width="1200" />
          <rect fill="url(#flowGrid)" height="560" width="1200" />

          {graph.edges.map((edge) => {
            const from = graph.nodeMap.get(edge.from);
            const to = graph.nodeMap.get(edge.to);
            if (!from || !to) return null;
            return (
              <path
                d={graphPath(from, to, edge.id, edge.index)}
                fill="none"
                key={edge.id}
                opacity="0.74"
                stroke="#a9a3ff"
                strokeLinecap="round"
                strokeWidth={edge.width}
              >
                <title>
                  {graphNodeLabel(edge.from, profiles)} vers{" "}
                  {graphNodeLabel(edge.to, profiles)} - {edge.label} -{" "}
                  {edge.count} fragment{edge.count > 1 ? "s" : ""}
                </title>
              </path>
            );
          })}

          {graph.edges.map((edge) => {
            if (!edge.showLabel) return null;
            const from = graph.nodeMap.get(edge.from);
            const to = graph.nodeMap.get(edge.to);
            if (!from || !to) return null;
            const labelX = (from.x + to.x) / 2;
              const labelY =
                (from.y + to.y) / 2 + (stableHash(edge.id) - 0.5) * 72;
            return (
              <g key={`${edge.id}:label`}>
                <rect
                  fill="#101114"
                  height="22"
                  opacity="0.82"
                  rx="6"
                  width="104"
                  x={labelX - 52}
                  y={labelY - 15}
                />
                <text
                  fill="#f4f2ec"
                  fontSize="11"
                  fontWeight="650"
                  textAnchor="middle"
                  x={labelX}
                  y={labelY}
                >
                  {edge.label}
                </text>
              </g>
            );
          })}

          {graph.nodes.map((node) => {
            const profile = profiles[node.address];
            const imageUrl = profile?.imageUrl?.trim();
            const clipId = `${graphId}-${node.address.slice(2, 10)}`;
            const active = activeNodeAddress === node.address;

            return (
              <g
                aria-label={`${graphNodeLabel(node.address, profiles)} - ${profileTypeLabel(
                  profile,
                )}`}
                data-flow-node={node.address}
                key={node.address}
                onBlur={() => setActiveNodeAddress(null)}
                onClick={(event) => openNodeWithPointer(event, node.address)}
                onFocus={() => setActiveNodeAddress(node.address)}
                onKeyDown={(event) => openNodeWithKeyboard(event, node.address)}
                onMouseEnter={() => setActiveNodeAddress(node.address)}
                onMouseLeave={() => setActiveNodeAddress(null)}
                role="button"
                style={{ cursor: "pointer", outline: "none" }}
                tabIndex={0}
                transform={`translate(${node.x} ${node.y})`}
              >
                <defs>
                  <clipPath id={clipId}>
                    <circle cx="0" cy="0" r={Math.max(2, node.r - 2)} />
                  </clipPath>
                </defs>
                {active ? (
                  <circle
                    fill="none"
                    opacity="0.95"
                    r={node.r + 7}
                    stroke="#ffffff"
                    strokeWidth="2.5"
                  />
                ) : null}
                <circle
                  fill={nodeFill[node.kind]}
                  opacity={node.kind === "relay" ? "0.95" : "1"}
                  r={node.r}
                  stroke={node.kind === "relay" ? "#d7d2c5" : "#f4f2ec"}
                  strokeOpacity={active ? "1" : "0.9"}
                  strokeWidth={active ? "3.5" : "2.5"}
                >
                  <title>
                    {graphNodeLabel(node.address, profiles)} -{" "}
                    {profileTypeLabel(profile)}
                  </title>
                </circle>
                {imageUrl ? (
                  <image
                    clipPath={`url(#${clipId})`}
                    height={(node.r - 2) * 2}
                    href={imageUrl}
                    preserveAspectRatio="xMidYMid slice"
                    width={(node.r - 2) * 2}
                    x={-(node.r - 2)}
                    y={-(node.r - 2)}
                  />
                ) : (
                  <text
                    fill={node.kind === "relay" ? "#101114" : "#ffffff"}
                    fontSize="10"
                    fontWeight="800"
                    textAnchor="middle"
                    y="3.5"
                  >
                    {compactGraphLabel(node.label).slice(0, 1).toUpperCase()}
                  </text>
                )}
                {imageUrl ? (
                  <circle
                    fill="none"
                    r={node.r}
                    stroke={node.kind === "relay" ? "#d7d2c5" : "#f4f2ec"}
                    strokeOpacity="0.92"
                    strokeWidth="2.5"
                  />
                ) : null}
              </g>
            );
          })}
          {activeNode ? (
            <FlowGraphNodeCard
              circleMember={circleMembersByAddress[activeNode.address]}
              node={activeNode}
              profile={profiles[activeNode.address]}
              signal={trustSignals[activeNode.address]}
              sourceAddress={sourceAddress}
            />
          ) : null}
          </svg>
        </div>
      </FullscreenGraphPortal>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-ink/55">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-[#5d7d44]" />
          Depart
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-[#857be3]" />
          Arrivee
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border border-ink/20 bg-[#f4f2ec]" />
          Relais
        </span>
        {graph.truncated ? (
          <span className="font-medium text-ink/60">
            Graphe limite aux {FLOW_GRAPH_TRANSFER_LIMIT} premiers transferts.
          </span>
        ) : null}
      </div>
    </div>
  );
}

function FlowMetric({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-md bg-sand/70 px-2.5 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">
        {label}
      </div>
      <div className="mt-1 break-words font-semibold tabular-nums text-ink">
        {value}
      </div>
    </div>
  );
}

function FlowDirectionCard({
  icon,
  pathfinder,
  subtitle,
  title,
  tone,
}: {
  icon: ReactNode;
  pathfinder: PathfinderState;
  subtitle: string;
  title: string;
  tone: "marine" | "sage";
}) {
  const iconTone =
    tone === "sage" ? "bg-sage/10 text-sage" : "bg-marine/10 text-marine";

  return (
    <div className="rounded-lg border border-ink/10 bg-white/55 p-3">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 rounded-md p-1.5 ${iconTone}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="break-words text-sm font-semibold text-ink">
            {title}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ink/60">
            {subtitle}
          </p>
        </div>
      </div>

      {pathfinder.status === "idle" ? (
        <div className="mt-3 rounded-md bg-sand/70 px-2.5 py-2 text-xs text-ink/55">
          Select a profile to calculate this direction.
        </div>
      ) : null}

      {pathfinder.status === "loading" ? (
        <div className="mt-3 flex items-center gap-2 rounded-md bg-sand/70 px-2.5 py-2 text-xs font-medium text-ink/60">
          <RefreshCw className="size-3.5 animate-spin" />
          Calculating flow
        </div>
      ) : null}

      {pathfinder.status === "error" ? (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-citrus/25 bg-citrus/10 px-2.5 py-2 text-xs text-citrus">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{pathfinder.error}</span>
        </div>
      ) : null}

      {pathfinder.status === "ready" ? (
        <>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <Badge
              className={
                hasPositiveFlow(pathfinder.preview.maxFlow)
                  ? "border-sage/25 bg-sage/10 text-sage"
                  : "border-citrus/25 bg-citrus/10 text-citrus"
              }
              variant="outline"
            >
              {hasPositiveFlow(pathfinder.preview.maxFlow)
                ? "Flow available"
                : "No flow"}
            </Badge>
            <span className="text-[11px] font-medium text-ink/45">
              Max {pathfinder.preview.maxTransfers} internal transfers
            </span>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <FlowMetric
              label="Max possible limit"
              value={`${pathfinder.preview.maxFlowCrc} CRC`}
            />
            <FlowMetric
              label="Rebuilt route"
              value={`${pathfinder.preview.requestedFlowCrc} / ${pathfinder.preview.targetFlowCrc}`}
            />
            <FlowMetric
              label="Max-route steps"
              value={`${pathfinder.preview.transfers.length} step${
                pathfinder.preview.transfers.length > 1 ? "s" : ""
              }`}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

function FlowRoutePreview({
  circleMembersByAddress,
  onOpenProfile,
  pathfinder,
  profiles,
  sourceAddress,
  title,
  trustSignals,
}: {
  circleMembersByAddress: Record<string, CircleMember>;
  onOpenProfile: (profile: ProfileSearchResult) => void;
  pathfinder: PathfinderState;
  profiles: Record<string, CirclesProfile>;
  sourceAddress: string | null;
  title: string;
  trustSignals: Record<string, TrustSignal>;
}) {
  if (pathfinder.status !== "ready") return null;

  const { preview } = pathfinder;
  const visibleTransfers = preview.transfers.slice(0, FLOW_ROUTE_PREVIEW_LIMIT);
  const hiddenTransfers = preview.transfers.length - visibleTransfers.length;

  return (
    <details open className="mt-3 rounded-lg border border-ink/10 bg-white/55 p-3">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink/45">
              {title}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink/60">
              Rebuilt route for the max limit. Internal fragments are not
              totals to add together.
            </p>
          </div>
          <Badge className="border-marine/20 bg-marine/10 text-marine" variant="outline">
            Route {preview.requestedFlowCrc} CRC
          </Badge>
        </div>
      </summary>

      <div className="mt-3">
        <div className="grid gap-2 md:grid-cols-3">
          <FlowMetric
            label="Route amount"
            value={`${preview.requestedFlowCrc} CRC`}
          />
          <FlowMetric
            label="Direction max limit"
            value={`${preview.maxFlowCrc} CRC`}
          />
          <FlowMetric
            label="Read"
            value="Internal fragments"
          />
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-md border border-marine/15 bg-marine/5 px-3 py-2 text-xs leading-relaxed text-ink/65">
          <Info className="mt-0.5 size-3.5 shrink-0 text-marine" />
          <span>
            A fragment crossing several accounts can appear across several
            hops: these are steps of the same flow piece.
          </span>
        </div>
      </div>

      <FlowRouteGraph
        circleMembersByAddress={circleMembersByAddress}
        onOpenProfile={onOpenProfile}
        preview={preview}
        profiles={profiles}
        sourceAddress={sourceAddress}
        trustSignals={trustSignals}
      />

      {visibleTransfers.length > 0 ? (
        <details className="mt-3 rounded-lg border border-ink/10 bg-white/45 p-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-ink/50">
            Raw fragment details ({preview.transfers.length})
          </summary>
          <div className="mt-3 space-y-1.5">
            {visibleTransfers.map((transfer, index) => (
              <div
                key={`${transfer.from}:${transfer.to}:${transfer.tokenOwner}:${index}`}
                className="rounded-md border border-ink/10 bg-white/60 px-2.5 py-2 text-xs"
              >
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center">
                  <FlowAddressChip address={transfer.from} profiles={profiles} />
                  <ArrowUpRight className="mx-auto size-3.5 text-marine" />
                  <FlowAddressChip address={transfer.to} profiles={profiles} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-ink/10 pt-2">
                  <span className="text-ink/45">via</span>
                  <span className="min-w-[180px] flex-1">
                    <FlowAddressChip address={transfer.tokenOwner} profiles={profiles} />
                  </span>
                  <span className="ml-auto rounded-md bg-sand/70 px-2 py-1 font-semibold tabular-nums text-ink/65">
                    Fragment {transfer.valueCrc} CRC
                  </span>
                </div>
              </div>
            ))}
            {hiddenTransfers > 0 ? (
              <div className="rounded-md bg-sand/70 px-2.5 py-2 text-xs font-medium text-ink/55">
                +{hiddenTransfers} internal transfer
                {hiddenTransfers > 1 ? "s" : ""} in this max route.
              </div>
            ) : null}
          </div>
        </details>
      ) : (
        <p className="mt-3 rounded-md bg-sand/70 px-2.5 py-2 text-xs text-ink/60">
          Pathfinder did not find a detailed route for this limit.
        </p>
      )}
    </details>
  );
}
function FlowPathPanel({
  circleMembersByAddress,
  memberName,
  memberToSource,
  onOpenProfile,
  profiles,
  sourceAddress,
  sourceLabel,
  sourceToMember,
  trustSignals,
}: {
  circleMembersByAddress: Record<string, CircleMember>;
  memberName: string;
  memberToSource: PathfinderState;
  onOpenProfile: (profile: ProfileSearchResult) => void;
  profiles: Record<string, CirclesProfile>;
  sourceAddress: string | null;
  sourceLabel: string;
  sourceToMember: PathfinderState;
  trustSignals: Record<string, TrustSignal>;
}) {
  if (memberToSource.status === "idle" && sourceToMember.status === "idle") {
    return null;
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white/55 p-3 text-sm text-ink/65">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-ink/45">
            Circulation path
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink/65">
            Direction matters. If {memberName} needs to send CRC to you, check
            <span className="font-semibold text-ink"> {memberName} -&gt; {sourceLabel}</span>:
            this direction matches the Send limit in Gnosis. The second
            direction answers the reverse question.
          </p>
        </div>
        <Badge className="w-fit border-ink/10 bg-sand/70 text-ink/60" variant="outline">
          Pathfinder
        </Badge>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <FlowDirectionCard
          icon={<ArrowDownLeft className="size-4" />}
          pathfinder={memberToSource}
          subtitle="Direction to check when this profile sends to the loaded address."
          title={`${memberName} -> ${sourceLabel}`}
          tone="sage"
        />
        <FlowDirectionCard
          icon={<ArrowUpRight className="size-4" />}
          pathfinder={sourceToMember}
          subtitle="Reverse question: what the loaded address could send to this profile."
          title={`${sourceLabel} -> ${memberName}`}
          tone="marine"
        />
      </div>

      <FlowRoutePreview
        circleMembersByAddress={circleMembersByAddress}
        onOpenProfile={onOpenProfile}
        pathfinder={memberToSource}
        profiles={profiles}
        sourceAddress={sourceAddress}
        title={`Max-limit route: ${memberName} -> ${sourceLabel}`}
        trustSignals={trustSignals}
      />
      <FlowRoutePreview
        circleMembersByAddress={circleMembersByAddress}
        onOpenProfile={onOpenProfile}
        pathfinder={sourceToMember}
        profiles={profiles}
        sourceAddress={sourceAddress}
        title={`Reverse max-limit route: ${sourceLabel} -> ${memberName}`}
        trustSignals={trustSignals}
      />
    </div>
  );
}

function MemberDetailPanel({
  advancedFlowOpen,
  circleMembersByAddress,
  member,
  onLoadProfile,
  onToggleAdvancedFlow,
  onToggleCleanup,
  pathfinderToMember,
  pathfinderToSource,
  profile,
  routeProfiles,
  routeTrustSignals,
  selectedForCleanup,
  signal,
  sourceAddress,
  sourceLabel,
}: {
  advancedFlowOpen: boolean;
  circleMembersByAddress: Record<string, CircleMember>;
  member: CircleMember | null;
  onLoadProfile: (profile: ProfileSearchResult) => void;
  onToggleAdvancedFlow: (open: boolean) => void;
  onToggleCleanup: (id: string) => void;
  pathfinderToMember: PathfinderState;
  pathfinderToSource: PathfinderState;
  profile?: CirclesProfile | null;
  routeProfiles: Record<string, CirclesProfile>;
  routeTrustSignals: Record<string, TrustSignal>;
  selectedForCleanup: boolean;
  signal?: TrustSignal | null;
  sourceAddress: string | null;
  sourceLabel: string;
}) {
  if (!member) {
    return (
      <aside className="rounded-lg border border-dashed border-ink/15 bg-white/35 p-4 text-sm text-ink/60">
        Select a person to view the relation, criteria and possible decision.
      </aside>
    );
  }

  const name = profile?.name?.trim() || shortenAddress(member.address);
  const isReview = member.bucket === "review";
  const decision = buildTrustDecision(member, signal, name);
  const status = cleanerStatus(member, signal, profile);
  const type = profileTypeLabel(profile);

  return (
    <aside className="rounded-lg border border-ink/10 bg-white/55 p-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(220px,0.75fr)_minmax(340px,1fr)_minmax(260px,0.85fr)] lg:items-stretch">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-start gap-3">
            <ProfileAvatar address={member.address} profile={profile} size="md" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold text-ink">
                {name}
              </div>
              <div className="truncate text-xs text-ink/55">
                {shortenAddress(member.address)} - {type}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <Badge className={decisionToneClass(status.tone)} variant="outline">
                {status.label}
              </Badge>
              <Badge className="border-ink/10 bg-sand/70 text-ink/60" variant="outline">
                {type}
              </Badge>
            </div>
          </div>

          <p className="rounded-lg border border-ink/10 bg-sand/60 p-3 text-sm leading-relaxed text-ink/70">
            {relationSentence(member, name)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-ink/10 bg-white/55 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink/45">
              Account type
            </div>
            <div className="mt-1 text-sm font-semibold text-ink">
              {type}
            </div>
          </div>
          <div className="rounded-lg border border-ink/10 bg-white/55 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink/45">
              Trust score
            </div>
            <div className="mt-1 text-sm font-semibold text-ink">
              {scoreLabel(signal)}
            </div>
          </div>
          <div className="rounded-lg border border-ink/10 bg-white/55 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink/45">
              Backer
            </div>
            <div className="mt-1 text-sm font-semibold text-ink">
              {backerLabel(signal)}
            </div>
          </div>
          <div className="rounded-lg border border-ink/10 bg-white/55 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink/45">
              Account age
            </div>
            <div className="mt-1 text-sm font-semibold text-ink">
              {accountAgeLabel(signal)}
            </div>
          </div>
          <div className="rounded-lg border border-ink/10 bg-white/55 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink/45">
              Network
            </div>
            <div className="mt-1 text-sm font-semibold text-ink">
              {networkLabel(signal)}
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink/45">
              Cleaner status
            </div>
            <Badge className={decisionToneClass(status.tone)} variant="outline">
              {status.label}
            </Badge>
          </div>
          <div className="rounded-lg border border-ink/10 bg-white/55 p-3 text-sm leading-relaxed text-ink/65">
            <p>{status.summary}</p>
            <div className="mt-3 grid gap-1.5 text-xs text-ink/55">
              {status.reasons.map((reason) => (
                <div key={reason} className="flex items-start gap-2">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-marine/45" />
                  <span>{reason}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-md bg-sand/70 px-2.5 py-2 text-xs font-medium text-ink/70">
              {decision.action}
            </div>
          </div>

              {isReview ? (
                <Button
                  type="button"
                  className="mt-auto w-full"
                  variant={selectedForCleanup ? "secondary" : "default"}
                  onClick={() => onToggleCleanup(cleanupRowId(member))}
                >
                  <ClipboardCheck className="size-4" />
                  {selectedForCleanup ? "Remove from plan" : "Untrust"}
                </Button>
              ) : null}
        </div>
      </div>
      <div className="mt-3">
        <details
          className="rounded-lg border border-ink/10 bg-white/50 p-3"
          open={advancedFlowOpen}
          onToggle={(event) => {
            onToggleAdvancedFlow(event.currentTarget.open);
          }}
        >
          <summary className="cursor-pointer text-sm font-semibold text-ink">
            Flow analysis (V2)
            <span className="ml-2 text-xs font-medium text-ink/45">
              optional
            </span>
          </summary>
          <div className="mt-3">
            <FlowPathPanel
              circleMembersByAddress={circleMembersByAddress}
              memberName={name}
              memberToSource={pathfinderToSource}
              onOpenProfile={onLoadProfile}
              profiles={routeProfiles}
              sourceAddress={sourceAddress}
              sourceLabel={sourceLabel}
              sourceToMember={pathfinderToMember}
              trustSignals={routeTrustSignals}
            />
          </div>
        </details>
      </div>
    </aside>
  );
}

function CleanupBar({
  onClear,
  onPrepare,
  selectedRows,
  profiles,
  trustSignals,
}: {
  onClear: () => void;
  onPrepare: () => void;
  profiles: Record<string, CirclesProfile>;
  selectedRows: CircleMember[];
  trustSignals: Record<string, TrustSignal>;
}) {
  if (selectedRows.length === 0) return null;
  const summary = selectedRows.reduce(
    (counts, member) => {
      const status = cleanerStatus(
        member,
        trustSignals[member.address],
        profiles[member.address],
      );
      if (status.label === "Urgent") counts.urgent += 1;
      else if (status.label === "Likely untrust") counts.probable += 1;
      else counts.verify += 1;
      return counts;
    },
    { probable: 0, urgent: 0, verify: 0 },
  );

  return (
    <div className="sticky bottom-3 z-20 rounded-lg border border-marine/20 bg-ink px-4 py-3 text-white shadow-xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold">
            {selectedRows.length} profile{selectedRows.length > 1 ? "s" : ""} added to the plan
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-medium">
            {summary.urgent > 0 ? (
              <span className="rounded-md bg-white/10 px-2 py-0.5 text-white/80">
                {summary.urgent} urgent
              </span>
            ) : null}
            {summary.probable > 0 ? (
              <span className="rounded-md bg-white/10 px-2 py-0.5 text-white/80">
                {summary.probable} probable
              </span>
            ) : null}
            {summary.verify > 0 ? (
              <span className="rounded-md bg-white/10 px-2 py-0.5 text-white/80">
                {summary.verify} to review
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-white/65">
            Nothing is sent automatically. No signature is submitted.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onClear}>
            Clear
          </Button>
          <Button type="button" onClick={onPrepare}>
            <ClipboardCheck className="size-4" />
            View untrust plan
          </Button>
        </div>
      </div>
    </div>
  );
}

function PreparedPlan({
  currentMembers,
  onRefreshGraph,
  profiles,
  readVersion,
  selectedRows,
  trustSignals,
}: {
  currentMembers: CircleMember[];
  onRefreshGraph: () => Promise<boolean>;
  profiles: Record<string, CirclesProfile>;
  readVersion: string | null;
  selectedRows: CircleMember[];
  trustSignals: Record<string, TrustSignal>;
}) {
  const wallet = useWallet();
  const [planDecisions, setPlanDecisions] = useState<Record<string, PlanDecision>>({});
  const [dryRun, setDryRun] = useState<DryRunState>({
    status: "idle",
    transactions: [],
  });
  const [signatureState, setSignatureState] = useState<SignatureState>({
    hashes: [],
    status: "idle",
  });
  const [signatureReviewOpen, setSignatureReviewOpen] = useState(false);
  const [verificationState, setVerificationState] = useState<VerificationState>({
    status: "idle",
    targets: [],
  });

  const preparedRows = selectedRows.map((member) => {
    const profile = profiles[member.address];
    const signal = trustSignals[member.address];
    const status = cleanerStatus(member, signal, profile);
    return {
      member,
      name: profile?.name?.trim() || shortenAddress(member.address),
      profile,
      signal,
      status,
      type: profileTypeLabel(profile),
    };
  });
  const groupedRows = [
    {
      helper: "Review first before signature.",
      id: "urgent",
      rows: preparedRows.filter((row) => row.status.label === "Urgent"),
      title: "Urgent",
    },
    {
      helper: "Natural untrust candidates, validate one by one.",
      id: "probable",
      rows: preparedRows.filter((row) => row.status.label === "Likely untrust"),
      title: "Likely untrust",
    },
    {
      helper: "Cases to reread: mixed signals or missing context.",
      id: "verify",
      rows: preparedRows.filter(
        (row) =>
          row.status.label !== "Urgent" &&
          row.status.label !== "Likely untrust",
      ),
      title: "To review",
    },
  ].filter((group) => group.rows.length > 0);
  const planSummary = preparedRows.reduce(
    (counts, row) => {
      const decision = planDecisions[cleanupRowId(row.member)] ?? "confirm";
      counts[decision] += 1;
      return counts;
    },
    { confirm: 0, keep: 0, later: 0 },
  );
  const confirmedRows = preparedRows.filter(
    (row) => (planDecisions[cleanupRowId(row.member)] ?? "confirm") === "confirm",
  );
  const dryRunMatchesPlan =
    dryRun.status === "ready" &&
    dryRun.transactions.length === confirmedRows.length &&
    dryRun.transactions.every((tx) =>
      confirmedRows.some((row) => row.member.address === tx.targetAddress),
    );
  const hasSignedTransactions =
    signatureState.status === "success" && dryRun.status === "ready";
  const showDryRunSnapshot =
    dryRun.status === "ready" && (dryRunMatchesPlan || hasSignedTransactions);
  const canSignUntrusts =
    wallet.isMiniappHost &&
    Boolean(wallet.address) &&
    dryRun.status === "ready" &&
    dryRunMatchesPlan &&
    signatureState.status !== "sending" &&
    signatureState.status !== "success";
  const signButtonLabel =
    signatureState.status === "sending"
      ? "Signature in progress"
      : signatureState.status === "success"
        ? "Signature sent"
      : !wallet.isMiniappHost || !wallet.address
      ? "Open in Circles host"
      : dryRun.status !== "ready" || !dryRunMatchesPlan
        ? "Dry-run required before signature"
          : `Review ${dryRun.transactions.length} untrust`;
  const currentMembersByAddress = useMemo(
    () =>
      new Map(
        currentMembers.map((member) => [
          member.address,
          member,
        ]),
      ),
    [currentMembers],
  );
  const verificationResults =
    verificationState.status === "checking" &&
    verificationState.startedReadVersion !== readVersion
      ? verificationState.targets.map((target) => {
          const currentMember = currentMembersByAddress.get(target.targetAddress);
          const stillOutgoing =
            currentMember?.bucket === "review" || currentMember?.bucket === "keep";
          return {
            ...target,
            relation: currentMember
              ? circleBucketLabel(currentMember.bucket)
              : "Absent from loaded circle",
            status: stillOutgoing ? ("still-present" as const) : ("removed" as const),
          };
        })
      : [];

  async function buildUntrustTransactions() {
    if (confirmedRows.length === 0) {
      throw new Error("No confirmed untrust to build the draft.");
    }

    const { Sdk } = await import("@aboutcircles/sdk");
    const sdk = new Sdk();
    return confirmedRows.map((row) => {
      const tx = sdk.core.hubV2.trust(row.member.address as `0x${string}`, 0n);
      return {
        data: tx.data,
        method: "trust(address,uint96)" as const,
        targetAddress: row.member.address,
        targetName: row.name,
        targetStatus: row.status.label,
        targetType: row.type,
        to: tx.to,
        value: (tx.value ?? 0n).toString(),
      };
    });
  }

  async function prepareDryRun() {
    try {
      const transactions = await buildUntrustTransactions();
      setDryRun({
        generatedAt: new Date().toISOString(),
        status: "ready",
        transactions,
      });
      setSignatureState({ hashes: [], status: "idle" });
      setVerificationState({ status: "idle", targets: [] });
    } catch (err) {
      setDryRun({
        error:
          err instanceof Error
            ? err.message
            : "Unable to build the transaction draft.",
        status: "error",
        transactions: [],
      });
    }
  }

  function openSignatureReview() {
    if (!wallet.isMiniappHost || !wallet.address) {
      setSignatureState({
        error: "Signature is only available inside the connected Circles app.",
        hashes: [],
        status: "error",
      });
      return;
    }

    if (dryRun.status !== "ready" || !dryRunMatchesPlan) {
      setSignatureState({
        error: "Run an up-to-date dry-run before signing.",
        hashes: [],
        status: "error",
      });
      return;
    }

    setSignatureReviewOpen(true);
  }

  async function signConfirmedUntrusts() {
    if (!wallet.isMiniappHost || !wallet.address) {
      setSignatureState({
        error: "Signature is only available inside the connected Circles app.",
        hashes: [],
        status: "error",
      });
      return;
    }

    if (dryRun.status !== "ready" || !dryRunMatchesPlan) {
      setSignatureState({
        error: "Run an up-to-date dry-run before signing.",
        hashes: [],
        status: "error",
      });
      return;
    }

    try {
      setSignatureReviewOpen(false);
      setSignatureState({ hashes: [], status: "sending" });
      const { sendTransactions } = await import("@aboutcircles/miniapp-sdk");
      const hashes = await sendTransactions(
        dryRun.transactions.map((tx) => ({
          data: tx.data,
          to: tx.to,
          value: tx.value,
        })),
      );
      setSignatureState({ hashes, status: "success" });
      setVerificationState({ status: "idle", targets: dryRun.transactions });
    } catch (err) {
      setSignatureState({
        error:
          err instanceof Error
            ? err.message
            : "The signature was rejected or failed.",
        hashes: [],
        status: "error",
      });
    }
  }

  async function verifySignedUntrusts() {
    if (
      dryRun.status !== "ready" ||
      (!dryRunMatchesPlan && signatureState.status !== "success")
    ) {
      setVerificationState({
        error: "Up-to-date dry-run required before rechecking.",
        status: "error",
        targets: [],
      });
      return;
    }

    setVerificationState({
      startedReadVersion: readVersion,
      status: "checking",
      targets: dryRun.transactions,
    });

    const ok = await onRefreshGraph();
    if (!ok) {
      setVerificationState({
        error: "Unable to reread the circle. Try again in a few seconds.",
        status: "error",
        targets: dryRun.transactions,
      });
    }
  }

  return (
    <div className="rounded-lg border border-marine/15 bg-marine/5 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2">
          <span className="rounded-md bg-marine/10 p-1.5 text-marine">
            <Trash2 className="size-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-ink">Untrust plan</h3>
            <p className="max-w-2xl text-xs leading-relaxed text-ink/60">
              {signatureState.status === "success"
                ? "Signature sent. The verification below confirms the on-chain result after rereading."
                : selectedRows.length > 0
                ? "No signature has been sent. The plan only organizes selected profiles before manual validation."
                : "Select an Untrust profile in the carousel: it will appear here before any signature."}
            </p>
          </div>
        </div>
        <Button
          type="button"
          disabled={planSummary.confirm === 0 || signatureState.status === "success"}
          onClick={() => void prepareDryRun()}
          variant="outline"
        >
          <ClipboardCheck className="size-4" />
          {signatureState.status === "success"
            ? "Signed action"
            : planSummary.confirm > 0
            ? `Dry-run ${planSummary.confirm} untrust`
            : "Dry-run unavailable"}
        </Button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-citrus/15 bg-white/55 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">
            Ready to sign
          </div>
          <div className="mt-1 text-lg font-semibold text-citrus">
            {planSummary.confirm}
          </div>
        </div>
        <div className="rounded-lg border border-amber/15 bg-white/55 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">
            To review
          </div>
          <div className="mt-1 text-lg font-semibold text-amber">
            {planSummary.later}
          </div>
        </div>
        <div className="rounded-lg border border-sage/15 bg-white/55 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">
            Keep
          </div>
          <div className="mt-1 text-lg font-semibold text-sage">
            {planSummary.keep}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-3">
        {groupedRows.length > 0 ? groupedRows.map((group) => (
          <section
            key={group.id}
            className="rounded-lg border border-ink/10 bg-white/60 p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-ink">
                  {group.title}
                </h4>
                <p className="text-xs text-ink/55">{group.helper}</p>
              </div>
              <Badge className="border-ink/10 bg-sand/70 text-ink/60" variant="outline">
                {group.rows.length} profile{group.rows.length > 1 ? "s" : ""}
              </Badge>
            </div>

            <div className="mt-3 grid gap-2">
              {group.rows.map(({ member, name, profile, signal, status, type }) => {
                const decision = planDecisions[cleanupRowId(member)] ?? "confirm";

                return (
                  <div
                    key={circleMemberId(member)}
                    className="rounded-lg border border-ink/10 bg-white/70 px-3 py-2"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <ProfileAvatar address={member.address} profile={profile} />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-ink">
                            {name}
                          </div>
                          <div className="truncate text-xs text-ink/55">
                            {shortenAddress(member.address)} - {type}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        <Badge className={decisionToneClass(status.tone)} variant="outline">
                          {status.label}
                        </Badge>
                        <Badge className={planDecisionTone(decision)} variant="outline">
                          {planDecisionLabel(decision)}
                        </Badge>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
                      <div>
                        <div className="flex flex-wrap gap-1.5 text-[11px] font-medium text-ink/60">
                          <span className="rounded-md bg-sand/70 px-2 py-1">
                            Type {type}
                          </span>
                          <span className="rounded-md bg-sand/70 px-2 py-1">
                            Score {scoreLabel(signal)}
                          </span>
                          <span className="rounded-md bg-sand/70 px-2 py-1">
                            Backer {backerLabel(signal)}
                          </span>
                          <span className="rounded-md bg-sand/70 px-2 py-1">
                            Age {accountAgeLabel(signal)}
                          </span>
                          <span className="rounded-md bg-sand/70 px-2 py-1">
                            Network {networkLabel(signal)}
                          </span>
                        </div>

                        <div className="mt-2 grid gap-1.5 text-xs text-ink/60 sm:grid-cols-2">
                          {status.reasons.slice(0, 4).map((reason) => (
                            <div key={reason} className="flex items-start gap-2">
                              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-citrus/55" />
                              <span>{reason}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <label className="block rounded-lg border border-ink/10 bg-sand/45 p-2">
                        <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink/45">
                          Decision
                        </span>
                        <select
                          value={decision}
                          onChange={(event) => {
                            const nextDecision = event.target.value as PlanDecision;
                            setPlanDecisions((current) => ({
                              ...current,
                              [cleanupRowId(member)]: nextDecision,
                            }));
                          }}
                          className="mt-1 h-9 w-full rounded-md border border-ink/15 bg-white px-2 text-sm font-semibold text-ink outline-none transition focus-visible:border-marine/40 focus-visible:ring-3 focus-visible:ring-marine/20"
                        >
                          <option value="confirm">Confirm untrust</option>
                          <option value="later">Review later</option>
                          <option value="keep">Keep</option>
                        </select>
                        <span className="mt-1 block text-xs leading-relaxed text-ink/55">
                          {planDecisionHelper(decision)}
                        </span>
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )) : (
          <div className="rounded-lg border border-dashed border-ink/15 bg-white/45 p-4 text-sm text-ink/60">
            No profile in the plan yet.
          </div>
        )}
      </div>

      <div className="mt-3 rounded-lg border border-dashed border-ink/15 bg-white/45 p-3 text-xs leading-relaxed text-ink/60">
        Clicking Untrust adds a profile to the plan. The next step is an
        explicit wallet validation, profile by profile or as a batch depending
        on what you choose.
      </div>

      <div className="mt-3 rounded-lg border border-marine/15 bg-white/60 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h4 className="text-sm font-semibold text-ink">
              Transaction draft
            </h4>
            <p className="text-xs leading-relaxed text-ink/60">
              The dry-run encodes what would be sent to the wallet. It signs
              nothing and sends nothing to the host.
            </p>
          </div>
          <Badge className="border-marine/20 bg-marine/10 text-marine" variant="outline">
            {dryRun.status === "ready"
              ? `${dryRun.transactions.length} call${dryRun.transactions.length > 1 ? "s" : ""}`
              : "No send"}
          </Badge>
        </div>

        {dryRun.status === "error" ? (
          <div className="mt-3 rounded-md border border-citrus/20 bg-citrus/10 px-3 py-2 text-xs font-medium text-citrus">
            {dryRun.error}
          </div>
        ) : null}

        {dryRun.status === "ready" &&
        !dryRunMatchesPlan &&
        signatureState.status !== "success" ? (
          <div className="mt-3 rounded-md border border-amber/20 bg-amber/10 px-3 py-2 text-xs font-medium text-amber">
            The plan changed since the last dry-run. Regenerate the draft
            before signing.
          </div>
        ) : null}

        {showDryRunSnapshot ? (
          <div className="mt-3 space-y-2">
            <div className="rounded-md bg-sand/60 px-3 py-2 text-xs text-ink/60">
              Generated at {new Date(dryRun.generatedAt).toLocaleTimeString()}.
              Action: `trust(target, 0)` on the Circles Hub.
            </div>
            {dryRun.transactions.map((tx, index) => (
              <details
                key={`${tx.targetAddress}:${index}`}
                className="rounded-lg border border-ink/10 bg-white/70 p-3"
              >
              <summary className="cursor-pointer text-sm font-semibold text-ink">
                {index + 1}. {tx.targetName} - untrust
              </summary>
                <div className="mt-2 grid gap-2 text-xs text-ink/60 sm:grid-cols-2">
                  <div className="rounded-md bg-sand/60 px-2 py-1.5">
                    Target: {shortenAddress(tx.targetAddress)} - {tx.targetType}
                  </div>
                  <div className="rounded-md bg-sand/60 px-2 py-1.5">
                    Decision: Confirmed untrust
                  </div>
                  <div className="rounded-md bg-sand/60 px-2 py-1.5">
                    Cleaner analysis: {tx.targetStatus}
                  </div>
                  <div className="rounded-md bg-sand/60 px-2 py-1.5">
                    Contract: {shortenAddress(tx.to)}
                  </div>
                  <div className="rounded-md bg-sand/60 px-2 py-1.5">
                    Value: {tx.value}
                  </div>
                  <div className="rounded-md bg-sand/60 px-2 py-1.5">
                    Method: {tx.method}
                  </div>
                  <div className="rounded-md bg-sand/60 px-2 py-1.5">
                    Expiry: 0
                  </div>
                </div>
                <div className="mt-2 break-all rounded-md border border-ink/10 bg-sand/70 p-2 font-mono text-[11px] leading-relaxed text-ink/55">
                  {tx.data}
                </div>
              </details>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-dashed border-ink/15 bg-sand/45 p-3 text-xs text-ink/55">
            Click Dry-run once the profiles to untrust are confirmed.
          </div>
        )}

        <div className="mt-3 rounded-lg border border-ink/10 bg-sand/45 p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h4 className="text-sm font-semibold text-ink">Signature wallet</h4>
              <p className="max-w-2xl text-xs leading-relaxed text-ink/60">
                Active only inside the connected Circles app. A review screen
                lists the profiles right before sending to the host.
              </p>
            </div>
            <Button
              type="button"
              disabled={!canSignUntrusts}
              onClick={openSignatureReview}
            >
              {signatureState.status === "sending" ? (
                <RefreshCw className="size-4 animate-spin" />
              ) : (
                <ClipboardCheck className="size-4" />
              )}
              {signButtonLabel}
            </Button>
          </div>

          {signatureState.status === "error" ? (
            <div className="mt-3 rounded-md border border-citrus/20 bg-citrus/10 px-3 py-2 text-xs font-medium text-citrus">
              {signatureState.error}
            </div>
          ) : null}

          {signatureState.status === "success" ? (
            <div className="mt-3 rounded-md border border-sage/20 bg-sage/10 px-3 py-2 text-xs text-sage">
              <div className="font-semibold">Signature sent.</div>
              <div className="mt-1 space-y-1 break-all font-mono">
                {signatureState.hashes.map((hash) => (
                  <div key={hash}>{hash}</div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-3 rounded-lg border border-ink/10 bg-white/55 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h4 className="text-sm font-semibold text-ink">
                  Verification after signature
                </h4>
                <p className="max-w-2xl text-xs leading-relaxed text-ink/60">
                  Rereads the circle and compares signed profiles with current
                  outgoing trusts.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={
                  signatureState.status !== "success" ||
                  (verificationState.status === "checking" &&
                    verificationResults.length === 0)
                }
                onClick={() => void verifySignedUntrusts()}
              >
                {verificationState.status === "checking" &&
                verificationResults.length === 0 ? (
                  <RefreshCw className="size-4 animate-spin" />
                ) : (
                  <Search className="size-4" />
                )}
                Reread circle
              </Button>
            </div>

            {signatureState.status !== "success" ? (
              <div className="mt-3 rounded-lg border border-dashed border-ink/15 bg-sand/45 p-3 text-xs text-ink/55">
                Available after a signature is sent.
              </div>
            ) : null}

            {verificationState.status === "error" ? (
              <div className="mt-3 rounded-md border border-citrus/20 bg-citrus/10 px-3 py-2 text-xs font-medium text-citrus">
                {verificationState.error}
              </div>
            ) : null}

            {verificationState.status === "checking" &&
            verificationResults.length === 0 ? (
              <div className="mt-3 rounded-md border border-marine/20 bg-marine/10 px-3 py-2 text-xs font-medium text-marine">
                Rereading circle...
              </div>
            ) : null}

            {verificationResults.length > 0 ? (
              <div className="mt-3 grid gap-2">
                {verificationResults.every((result) => result.status === "removed") ? (
                  <div className="rounded-md border border-sage/20 bg-sage/10 px-3 py-2 text-xs font-medium text-sage">
                    Verification successful: every signed profile has been
                    removed from the loaded outgoing trust list.
                  </div>
                ) : null}
                {verificationResults.map((result) => (
                  <div
                    key={result.targetAddress}
                    className="flex flex-col gap-2 rounded-lg border border-ink/10 bg-white/70 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ink">
                        {result.targetName}
                      </div>
                      <div className="truncate text-xs text-ink/55">
                        {shortenAddress(result.targetAddress)} - {result.relation}
                      </div>
                    </div>
                    <Badge
                      className={
                        result.status === "removed"
                          ? "border-sage/25 bg-sage/10 text-sage"
                          : "border-citrus/25 bg-citrus/10 text-citrus"
                      }
                      variant="outline"
                    >
                      {result.status === "removed" ? "Removed" : "Still present"}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {signatureReviewOpen &&
      dryRun.status === "ready" &&
      dryRunMatchesPlan
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4 backdrop-blur-sm">
              <div className="max-h-[min(720px,90vh)] w-full max-w-2xl overflow-hidden rounded-lg border border-ink/10 bg-white shadow-2xl">
                <div className="border-b border-ink/10 bg-sand/80 px-4 py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-ink">
                        Final review
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-ink/60">
                        This step sends a real signature request to the Circles
                        wallet. Each line sets the trust to zero.
                      </p>
                    </div>
                    <Badge className="border-citrus/25 bg-citrus/10 text-citrus" variant="outline">
                      {dryRun.transactions.length} untrust
                    </Badge>
                  </div>
                </div>

                <div className="max-h-[52vh] overflow-auto p-4">
                  <div className="rounded-lg border border-citrus/20 bg-citrus/10 p-3 text-xs leading-relaxed text-citrus">
                    After signature, these profiles will no longer be trusted by
                    your wallet. You can reread the circle right after to verify
                    the result.
                  </div>

                  <div className="mt-3 grid gap-2">
                    {dryRun.transactions.map((tx, index) => (
                      <div
                        key={`${tx.targetAddress}:review:${index}`}
                        className="rounded-lg border border-ink/10 bg-sand/45 p-3"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-ink">
                              {index + 1}. {tx.targetName}
                            </div>
                            <div className="truncate text-xs text-ink/55">
                              {shortenAddress(tx.targetAddress)} - {tx.targetType}
                            </div>
                          </div>
                          <Badge className="border-citrus/25 bg-citrus/10 text-citrus" variant="outline">
                            Confirmed untrust
                          </Badge>
                        </div>
                        <div className="mt-2 grid gap-2 text-xs text-ink/60 sm:grid-cols-2">
                          <div className="rounded-md bg-white/70 px-2 py-1.5">
                            Method: {tx.method}
                          </div>
                          <div className="rounded-md bg-white/70 px-2 py-1.5">
                            Expiry: 0
                          </div>
                          <div className="rounded-md bg-white/70 px-2 py-1.5">
                            Cleaner analysis: {tx.targetStatus}
                          </div>
                          <div className="rounded-md bg-white/70 px-2 py-1.5">
                            Value: {tx.value}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col-reverse gap-2 border-t border-ink/10 bg-white px-4 py-3 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setSignatureReviewOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void signConfirmedUntrusts()}
                  >
                    <ClipboardCheck className="size-4" />
                    Sign now
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function ReviewCarousel({
  members,
  onSelect,
  onToggleCleanup,
  profiles,
  selectedCleanupIds,
  trustSignals,
}: {
  members: CircleMember[];
  onSelect: (member: CircleMember) => void;
  onToggleCleanup: (id: string) => void;
  profiles: Record<string, CirclesProfile>;
  selectedCleanupIds: Set<string>;
  trustSignals: Record<string, TrustSignal>;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const scrollVelocityRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const [canMouseScroll, setCanMouseScroll] = useState(false);
  const reviewStats = useMemo(() => {
    let urgent = 0;
    let probable = 0;
    let toVerify = 0;

    for (const member of members) {
      const status = cleanerStatus(member, trustSignals[member.address], profiles[member.address]);
      if (status.label === "Urgent") {
        urgent += 1;
      } else if (status.label === "Likely untrust") {
        probable += 1;
      } else {
        toVerify += 1;
      }
    }

    return { probable, urgent, toVerify };
  }, [members, profiles, trustSignals]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      setCanMouseScroll(false);
      return;
    }
    const currentScroller = scroller;

    function updateScrollState() {
      setCanMouseScroll(
        currentScroller.scrollWidth > currentScroller.clientWidth + 1,
      );
    }

    updateScrollState();
    window.addEventListener("resize", updateScrollState);
    return () => window.removeEventListener("resize", updateScrollState);
  }, [members.length]);

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, []);

  function runMouseScroll() {
    const scroller = scrollerRef.current;
    const velocity = scrollVelocityRef.current;

    if (!scroller || Math.abs(velocity) < 0.1) {
      scrollFrameRef.current = null;
      return;
    }

    const maxScroll = scroller.scrollWidth - scroller.clientWidth;
    const nextScroll = Math.min(
      maxScroll,
      Math.max(0, scroller.scrollLeft + velocity),
    );
    scroller.scrollLeft = nextScroll;
    scrollFrameRef.current = window.requestAnimationFrame(runMouseScroll);
  }

  function scrollWithMouse(event: MouseEvent<HTMLDivElement>) {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const maxScroll = scroller.scrollWidth - scroller.clientWidth;
    if (maxScroll <= 0) return;

    const rect = scroller.getBoundingClientRect();
    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)),
    );
    const offset = ratio - 0.5;
    const activeOffset = Math.max(
      0,
      (Math.abs(offset) - CAROUSEL_MOUSE_SCROLL_DEAD_ZONE) /
        (0.5 - CAROUSEL_MOUSE_SCROLL_DEAD_ZONE),
    );

    if (activeOffset <= 0) {
      stopMouseScroll();
      return;
    }

    scrollVelocityRef.current =
      Math.sign(offset) *
      CAROUSEL_MOUSE_SCROLL_MAX_STEP *
      activeOffset ** 1.7;
    if (scrollFrameRef.current === null) {
      scrollFrameRef.current = window.requestAnimationFrame(runMouseScroll);
    }
  }

  function stopMouseScroll() {
    scrollVelocityRef.current = 0;
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }
  }

  if (!members.length) return null;

  return (
    <section className="mt-4 rounded-lg border border-citrus/20 bg-citrus/5 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-ink">
              {members.length} outgoing trusts to audit
            </h3>
            <Badge className="border-citrus/25 bg-white/70 text-citrus" variant="outline">
              decision aid
            </Badge>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {reviewStats.urgent > 0 ? (
              <Badge className="border-citrus/25 bg-citrus/10 text-citrus" variant="outline">
                {reviewStats.urgent} urgent
              </Badge>
            ) : null}
            {reviewStats.probable > 0 ? (
              <Badge className="border-amber/25 bg-amber/10 text-amber" variant="outline">
                {reviewStats.probable} likely untrust
              </Badge>
            ) : null}
            {reviewStats.toVerify > 0 ? (
              <Badge className="border-marine/20 bg-marine/10 text-marine" variant="outline">
                {reviewStats.toVerify} to review
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink/60">
            Complete list of outgoing-only trusts, sorted by risk. No top 10:
            urgent cases rise first, without automatic selection.
          </p>
        </div>
        {canMouseScroll ? (
          <div className="rounded-md bg-white/70 px-2.5 py-1.5 text-xs font-semibold text-ink/60">
            Hover to scroll
          </div>
        ) : null}
      </div>

      <div
        ref={scrollerRef}
        className="mt-3 overflow-x-auto pb-2"
        onMouseLeave={stopMouseScroll}
        onMouseMove={scrollWithMouse}
      >
        <div className="flex min-w-full snap-x gap-3">
          {members.map((member) => {
            const profile = profiles[member.address];
            const signal = trustSignals[member.address];
            const name = profile?.name?.trim() || shortenAddress(member.address);
            const status = cleanerStatus(member, signal, profile);
            const selected = selectedCleanupIds.has(cleanupRowId(member));
            const type = profileTypeLabel(profile);

            return (
              <article
                key={circleMemberId(member)}
                className={
                  "flex w-[280px] shrink-0 snap-start flex-col rounded-lg border bg-white/75 p-3 shadow-sm transition " +
                  (selected
                    ? "border-citrus/45 ring-2 ring-citrus/15"
                    : "border-ink/10")
                }
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-citrus/10 text-citrus">
                      <ShieldAlert className="size-3.5" />
                    </span>
                    <ProfileAvatar address={member.address} profile={profile} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ink">
                        {name}
                      </div>
                      <div className="truncate text-xs text-ink/50">
                        {shortenAddress(member.address)} - {type}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge className={decisionToneClass(status.tone)} variant="outline">
                    {status.label}
                  </Badge>
                  <Badge className="border-ink/10 bg-sand/70 text-ink/60" variant="outline">
                    {type}
                  </Badge>
                  <Badge className="border-ink/10 bg-sand/70 text-ink/60" variant="outline">
                    Backer {backerLabel(signal)}
                  </Badge>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-1.5 text-[11px] text-ink/55">
                  <span className="truncate rounded-md bg-sand/60 px-2 py-1">
                    Score {scoreLabel(signal)}
                  </span>
                  <span className="truncate rounded-md bg-sand/60 px-2 py-1">
                    Age {accountAgeLabel(signal)}
                  </span>
                </div>

                <div className="mt-3 grid gap-1.5 text-xs text-ink/60">
                  {status.reasons.slice(0, 3).map((reason) => (
                    <div key={reason} className="flex items-start gap-2">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-citrus/55" />
                      <span>{reason}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-auto flex flex-wrap gap-2 pt-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-ink/15 bg-white/70 hover:border-marine/30 hover:bg-white"
                    onClick={() => onSelect(member)}
                  >
                    <Search className="size-3.5" />
                    View
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={selected ? "secondary" : "default"}
                    onClick={() => onToggleCleanup(cleanupRowId(member))}
                  >
                    <ClipboardCheck className="size-3.5" />
                    {selected ? "Remove from plan" : "Untrust"}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function TrustCircleManager({
  analysis,
  onClear,
  onLoadProfile,
  onPrepare,
  onRememberProfile,
  onRefreshGraph,
  onSelectAll,
  onSelectMember,
  onToggleCleanup,
  previewOpen,
  profiles,
  readVersion,
  selectedCleanupIds,
  selectedMemberId,
  sourceAddress,
  trustSignals,
}: {
  analysis: CleanerAnalysis;
  onClear: () => void;
  onLoadProfile: (profile: ProfileSearchResult) => void;
  onPrepare: () => void;
  onRememberProfile: (profile: ProfileSearchResult) => void;
  onRefreshGraph: () => Promise<boolean>;
  onSelectAll: () => void;
  onSelectMember: (member: CircleMember) => void;
  onToggleCleanup: (id: string) => void;
  previewOpen: boolean;
  profiles: Record<string, CirclesProfile>;
  readVersion: string | null;
  selectedCleanupIds: Set<string>;
  selectedMemberId: string | null;
  sourceAddress: string | null;
  trustSignals: Record<string, TrustSignal>;
}) {
  const keepMembers = useMemo(
    () =>
      analysis.mutual.map((row) => ({
        ...row,
        bucket: "keep" as const,
      })),
    [analysis.mutual],
  );
  const reviewMembers = useMemo(
    () =>
      analysis.outgoingOnly
        .map((row) => ({ ...row, bucket: "review" as const }))
        .sort((left, right) => {
          const priority =
            cleanupPriority(trustSignals[left.address]) -
            cleanupPriority(trustSignals[right.address]);
          if (priority !== 0) return priority;
          return (
            (trustSignals[left.address]?.trustScore ?? -1) -
            (trustSignals[right.address]?.trustScore ?? -1)
          );
        }),
    [analysis.outgoingOnly, trustSignals],
  );
  const incomingMembers = useMemo(
    () =>
      analysis.incomingOnly.map((row) => ({
        ...row,
        bucket: "incoming" as const,
      })),
    [analysis.incomingOnly],
  );
  const allMembers = useMemo(
    () => [...reviewMembers, ...keepMembers, ...incomingMembers],
    [incomingMembers, keepMembers, reviewMembers],
  );
  const detailMember =
    allMembers.find((member) => circleMemberId(member) === selectedMemberId) ??
    allMembers[0] ??
    null;
  const detailAddress = detailMember?.address ?? "";
  const [advancedFlowAddress, setAdvancedFlowAddress] = useState<string | null>(null);
  const advancedFlowOpen = Boolean(detailAddress && advancedFlowAddress === detailAddress);
  const selectedRows = reviewMembers.filter((member) =>
    selectedCleanupIds.has(cleanupRowId(member)),
  );
  const planRef = useRef<HTMLDivElement | null>(null);
  const sortedReviewMembers = useMemo(
    () =>
      [...reviewMembers]
        .sort(
          (left, right) =>
            cleanerReviewScore(right, trustSignals[right.address], profiles[right.address]) -
            cleanerReviewScore(left, trustSignals[left.address], profiles[left.address]),
        ),
    [profiles, reviewMembers, trustSignals],
  );
  const normalizedSourceAddress = sourceAddress?.toLowerCase() ?? "";
  const sourceProfileName =
    normalizedSourceAddress ? profiles[normalizedSourceAddress]?.name?.trim() : "";
  const sourceLabel =
    sourceProfileName ||
    (normalizedSourceAddress === DEFAULT_LAUNCH_ADDRESS.toLowerCase()
      ? "@cryptosnf"
      : "loaded address");
  const [sourceToMemberPathfinder, setSourceToMemberPathfinder] = useState<PathfinderState>({
    status: "idle",
  });
  const [memberToSourcePathfinder, setMemberToSourcePathfinder] = useState<PathfinderState>({
    status: "idle",
  });
  const [pathfinderProfiles, setPathfinderProfiles] = useState<
    Record<string, CirclesProfile>
  >({});
  const [pathfinderSignals, setPathfinderSignals] = useState<
    Record<string, TrustSignal>
  >({});
  const [circleSearchTerm, setCircleSearchTerm] = useState("");
  const [circleSearchLoading, setCircleSearchLoading] = useState(false);
  const [circleSearchNotice, setCircleSearchNotice] = useState<{
    description: string;
    title: string;
  } | null>(null);
  const [circleSearchResults, setCircleSearchResults] = useState<ProfileSearchResult[]>([]);
  const [circleSearchOpen, setCircleSearchOpen] = useState(false);
  const trimmedCircleSearch = circleSearchTerm.trim();
  const canSearchCircle =
    trimmedCircleSearch.length >= 2 && allMembers.length > 0 && !circleSearchLoading;

  useEffect(() => {
    if (!previewOpen || selectedRows.length === 0) return;
    window.requestAnimationFrame(() => {
      planRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [previewOpen, selectedRows.length]);

  const localCircleResults = trimmedCircleSearch.length >= 2
    ? allMembers
        .filter((member) => {
          const normalized = normalizeAddress(trimmedCircleSearch);
          if (normalized) return member.address === normalized;
          const lowered = trimmedCircleSearch.toLowerCase();
          const profileName = profiles[member.address]?.name?.toLowerCase() ?? "";
          return profileName.includes(lowered) || member.address.includes(lowered);
        })
        .map((member) => ({
          address: member.address,
          name: profiles[member.address]?.name?.trim() || shortenAddress(member.address),
          imageUrl: profiles[member.address]?.imageUrl ?? null,
        }))
    : [];
  const circleSearchCandidates = [
    ...new Map(
      [...localCircleResults, ...circleSearchResults].map((profile) => [
        profile.address.toLowerCase(),
        { ...profile, address: profile.address.toLowerCase() },
      ]),
    ).values(),
  ].slice(0, 6);
  const pathfinderProfileAddresses = useMemo(() => {
    const addresses = new Set<string>();
    collectPathfinderAddresses(sourceToMemberPathfinder, addresses);
    collectPathfinderAddresses(memberToSourcePathfinder, addresses);
    return Array.from(addresses);
  }, [memberToSourcePathfinder, sourceToMemberPathfinder]);
  const routeProfiles = useMemo(
    () => ({ ...pathfinderProfiles, ...profiles }),
    [pathfinderProfiles, profiles],
  );
  const routeTrustSignals = useMemo(
    () => ({ ...pathfinderSignals, ...trustSignals }),
    [pathfinderSignals, trustSignals],
  );
  const circleMembersByAddress = useMemo(
    () =>
      Object.fromEntries(
        allMembers.map((member) => [member.address, member]),
      ) as Record<string, CircleMember>,
    [allMembers],
  );

  useEffect(() => {
    const term = circleSearchTerm.trim();
    if (term.length < 2 || normalizeAddress(term)) {
      queueMicrotask(() => {
        setCircleSearchResults([]);
        if (term.length < 2) setCircleSearchOpen(false);
        setCircleSearchLoading(false);
      });
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setCircleSearchLoading(true);
      void fetch(`/api/profiles/search?q=${encodeURIComponent(term)}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) return { results: [] };
          return (await response.json()) as { results?: ProfileSearchResult[] };
        })
        .then((data) => {
          setCircleSearchResults(data.results ?? []);
          setCircleSearchOpen(true);
        })
        .catch(() => {
          if (!controller.signal.aborted) setCircleSearchResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setCircleSearchLoading(false);
        });
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [circleSearchTerm]);

  useEffect(() => {
    if (!sourceAddress || !detailAddress || !advancedFlowOpen) {
      queueMicrotask(() => {
        setSourceToMemberPathfinder({ status: "idle" });
        setMemberToSourcePathfinder({ status: "idle" });
      });
      return;
    }

    const controller = new AbortController();
    const loadPathfinder = async (from: string, to: string) => {
      const response = await fetch("/api/pathfinder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to,
          pathMode: PATHFINDER_PATH_MODE,
          targetFlow: PATHFINDER_TARGET_FLOW,
          useWrappedBalances: true,
          maxTransfers: PATHFINDER_MAX_TRANSFERS,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error("pathfinder unavailable");
      }
      return (await response.json()) as PathfinderPreview;
    };

    queueMicrotask(() => {
      setSourceToMemberPathfinder({ status: "loading" });
      setMemberToSourcePathfinder({ status: "loading" });
    });
    void Promise.allSettled([
      loadPathfinder(sourceAddress, detailAddress),
      loadPathfinder(detailAddress, sourceAddress),
    ]).then(([sourceToMember, memberToSource]) => {
      if (controller.signal.aborted) return;

      setSourceToMemberPathfinder(
        sourceToMember.status === "fulfilled"
          ? { status: "ready", preview: sourceToMember.value }
          : {
              status: "error",
              error: "Circulation path unavailable for this direction.",
            },
      );
      setMemberToSourcePathfinder(
        memberToSource.status === "fulfilled"
          ? { status: "ready", preview: memberToSource.value }
          : {
              status: "error",
              error: "Circulation path unavailable for this direction.",
            },
      );
    });

    return () => controller.abort();
  }, [advancedFlowOpen, detailAddress, sourceAddress]);

  useEffect(() => {
    const missing = pathfinderProfileAddresses.filter(
      (profileAddress) =>
        !profiles[profileAddress] && !pathfinderProfiles[profileAddress],
    );
    if (!missing.length) return;

    const controller = new AbortController();
    void fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addresses: missing }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as {
          profiles?: Record<string, CirclesProfile>;
        };
      })
      .then((data) => {
        if (!data?.profiles) return;
        setPathfinderProfiles((current) => ({
          ...current,
          ...data.profiles,
        }));
      })
      .catch(() => {});

    return () => controller.abort();
  }, [pathfinderProfileAddresses, pathfinderProfiles, profiles]);

  useEffect(() => {
    const missing = pathfinderProfileAddresses.filter(
      (profileAddress) =>
        !trustSignals[profileAddress] && !pathfinderSignals[profileAddress],
    );
    if (!missing.length) return;

    const controller = new AbortController();
    void fetch("/api/trust-scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addresses: missing }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as {
          trustProfiles?: Record<string, TrustSignal>;
        };
      })
      .then((data) => {
        if (!data?.trustProfiles) return;
        setPathfinderSignals((current) => ({
          ...current,
          ...data.trustProfiles,
        }));
      })
      .catch(() => {});

    return () => controller.abort();
  }, [pathfinderProfileAddresses, pathfinderSignals, trustSignals]);

  function findCircleMemberByAddress(profileAddress: string) {
    const normalized = normalizeAddress(profileAddress);
    if (!normalized) return null;
    return allMembers.find((member) => member.address === normalized) ?? null;
  }

  function findCircleMemberLocally(term: string) {
    const normalized = normalizeAddress(term);
    if (normalized) return findCircleMemberByAddress(normalized);

    const lowered = term.toLowerCase();
    return (
      allMembers.find((member) => {
        const profileName = profiles[member.address]?.name?.toLowerCase() ?? "";
        return profileName.includes(lowered) || member.address.includes(lowered);
      }) ?? null
    );
  }

  function showCircleHit(member: CircleMember) {
    onSelectMember(member);
    setCircleSearchNotice(null);
    setCircleSearchOpen(false);
  }

  function previewCircleProfile(profile: ProfileSearchResult) {
    const member = findCircleMemberByAddress(profile.address);
    if (member) {
      onRememberProfile(profile);
      showCircleHit(member);
      return;
    }
    setCircleSearchNotice({
      title: `${profile.name} is not in this circle`,
      description:
        "This profile exists, but it does not appear in the loaded relations. You can open its own circle to explore around it.",
    });
  }

  async function searchInsideCircle() {
    const term = circleSearchTerm.trim();
    if (term.length < 2 || circleSearchLoading) return;

    const firstCandidate = circleSearchCandidates[0];
    if (firstCandidate) {
      previewCircleProfile(firstCandidate);
      return;
    }

    const localMember = findCircleMemberLocally(term);
    if (localMember) {
      showCircleHit(localMember);
      return;
    }

    setCircleSearchLoading(true);
    setCircleSearchNotice(null);
    try {
      const response = await fetch(
        `/api/profiles/search?q=${encodeURIComponent(term)}`,
        { cache: "no-store" },
      );
      const data = response.ok
        ? ((await response.json()) as { results?: ProfileSearchResult[] })
        : { results: [] };
      const matches = data.results ?? [];
      const match = matches
        .map((profile) => ({
          member: findCircleMemberByAddress(profile.address),
          profile,
        }))
        .find((entry) => entry.member);

      if (match?.member) {
        onRememberProfile(match.profile);
        showCircleHit(match.member);
        return;
      }

      setCircleSearchNotice({
        title: "Not in this circle",
        description:
          matches.length > 0
            ? `${matches.length} profile(s) found for "${term}", but none appear in the loaded trust graph.`
            : `No Circles profile found for "${term}".`,
      });
    } catch {
      setCircleSearchNotice({
        title: "Search unavailable",
        description: "Profile search did not respond. Try again in a moment.",
      });
    } finally {
      setCircleSearchLoading(false);
    }
  }

  return (
    <section className="trust-panel rounded-lg p-4 sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight text-ink">
              Circle cleaner
            </h2>
            <Badge className="border-citrus/25 bg-citrus/10 text-citrus" variant="outline">
              Cleaner
            </Badge>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-ink/65">
            Focus first on outgoing-only trusts: these are commitments you can
            clean without breaking a direct mutual relation.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-lg border border-ink/10 bg-white/45 p-2 text-center">
          <div className="px-2">
            <div className="text-lg font-semibold text-ink">{keepMembers.length}</div>
            <div className="text-[11px] uppercase tracking-wide text-ink/45">Mutual</div>
          </div>
          <div className="px-2">
            <div className="text-lg font-semibold text-citrus">{reviewMembers.length}</div>
            <div className="text-[11px] uppercase tracking-wide text-ink/45">Outgoing</div>
          </div>
          <div className="px-2">
            <div className="text-lg font-semibold text-marine">{incomingMembers.length}</div>
            <div className="text-[11px] uppercase tracking-wide text-ink/45">Incoming</div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-2 rounded-lg border border-marine/15 bg-marine/5 p-3 text-sm text-ink/70 lg:grid-cols-3">
        <div>
          <span className="font-semibold text-ink">Trust rule:</span>{" "}
          trusting someone means accepting their CRC in your economy.
        </div>
        <div>
          <span className="font-semibold text-ink">Goal:</span>{" "}
          audit your outgoing commitments, not judge people.
        </div>
        <div>
          <span className="font-semibold text-ink">Priority:</span>{" "}
          review outgoing-only trusts before any action.
        </div>
      </div>

      <ReviewCarousel
        members={sortedReviewMembers}
        onSelect={onSelectMember}
        onToggleCleanup={onToggleCleanup}
        profiles={profiles}
        selectedCleanupIds={selectedCleanupIds}
        trustSignals={trustSignals}
      />

      <div ref={planRef} className="mt-4 scroll-mt-24">
        <PreparedPlan
          currentMembers={allMembers}
          onRefreshGraph={onRefreshGraph}
          profiles={profiles}
          readVersion={readVersion}
          selectedRows={selectedRows}
          trustSignals={trustSignals}
        />
      </div>

      <div className="mt-4 rounded-lg border border-ink/10 bg-white/45 p-3">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void searchInsideCircle();
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink/35" />
            <input
              value={circleSearchTerm}
              onChange={(event) => {
                setCircleSearchTerm(event.target.value);
                if (circleSearchNotice) setCircleSearchNotice(null);
                setCircleSearchOpen(true);
              }}
              onFocus={() => {
                if (trimmedCircleSearch.length >= 2) setCircleSearchOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") setCircleSearchOpen(false);
              }}
              aria-label="Search inside current circle"
              placeholder="Search a name or address in this circle"
              className="h-10 w-full min-w-0 rounded-lg border border-ink/15 bg-white/80 px-3 pl-9 text-sm text-ink shadow-sm outline-none transition placeholder:text-ink/35 focus-visible:border-marine/40 focus-visible:ring-3 focus-visible:ring-marine/20"
            />
          </div>
          <Button type="submit" disabled={!canSearchCircle}>
            {circleSearchLoading ? (
              <RefreshCw className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
            Locate
          </Button>
        </form>
        {circleSearchOpen && trimmedCircleSearch.length >= 2 ? (
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {circleSearchCandidates.length > 0 ? (
              circleSearchCandidates.map((profile) => {
                const member = findCircleMemberByAddress(profile.address);
                const selectedForCleanup = member
                  ? selectedCleanupIds.has(cleanupRowId(member))
                  : false;
                return (
                  <div
                    key={profile.address}
                    className="rounded-lg border border-ink/10 bg-white/65 p-3 shadow-sm"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <ProfileAvatar address={profile.address} profile={profile} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-ink">
                          {profile.name}
                        </div>
                        <div className="truncate text-xs text-ink/55">
                          {shortenAddress(profile.address)}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <Badge
                            className={
                              member
                                ? circleBucketTone(member.bucket)
                                : "border-ink/10 bg-sand/70 text-ink/60"
                            }
                            variant="outline"
                          >
                            {member ? circleBucketLabel(member.bucket) : "Outside circle"}
                          </Badge>
                          {member ? (
                            <TrustSignalBadge
                              signal={trustSignals[member.address]}
                              compact
                            />
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={!member}
                        onClick={() => previewCircleProfile(profile)}
                      >
                        <Search className="size-3.5" />
                        Locate
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="border-ink/15 bg-white/70 hover:border-marine/30 hover:bg-white"
                        onClick={() => onLoadProfile(profile)}
                      >
                        <Eye className="size-3.5" />
                        View their circle
                      </Button>
                      {member?.bucket === "review" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant={selectedForCleanup ? "secondary" : "outline"}
                          className={
                            selectedForCleanup
                              ? ""
                              : "border-ink/15 bg-white/70 hover:border-citrus/30 hover:bg-white"
                          }
                          onClick={() => onToggleCleanup(cleanupRowId(member))}
                        >
                          <ClipboardCheck className="size-3.5" />
                          {selectedForCleanup ? "Remove from plan" : "Untrust"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-lg border border-dashed border-ink/15 bg-white/35 p-3 text-sm text-ink/55 md:col-span-2 xl:col-span-3">
                {circleSearchLoading
                  ? "Searching profiles..."
                  : "No profile found for this search."}
              </div>
            )}
          </div>
        ) : null}
        {circleSearchNotice ? (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-citrus/25 bg-citrus/10 p-3 text-sm text-citrus">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="block font-semibold">{circleSearchNotice.title}</span>
              <span className="block text-ink/65">{circleSearchNotice.description}</span>
            </span>
          </div>
        ) : null}
        {detailMember ? (
          <div className="mt-3">
            <MemberDetailPanel
              advancedFlowOpen={advancedFlowOpen}
              circleMembersByAddress={circleMembersByAddress}
              member={detailMember}
              onLoadProfile={onLoadProfile}
              onToggleAdvancedFlow={(open) => {
                setAdvancedFlowAddress(open ? detailAddress : null);
              }}
              onToggleCleanup={onToggleCleanup}
              pathfinderToMember={sourceToMemberPathfinder}
              pathfinderToSource={memberToSourcePathfinder}
              profile={routeProfiles[detailMember.address]}
              routeProfiles={routeProfiles}
              routeTrustSignals={routeTrustSignals}
              selectedForCleanup={selectedCleanupIds.has(cleanupRowId(detailMember))}
              signal={trustSignals[detailMember.address]}
              sourceAddress={sourceAddress}
              sourceLabel={sourceLabel}
            />
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <CircleColumn
          empty="No outgoing trust without return."
          members={reviewMembers}
          onSelect={onSelectMember}
          onToggleCleanup={onToggleCleanup}
          profiles={profiles}
          selectedCleanupIds={selectedCleanupIds}
          selectedMemberId={selectedMemberId}
          title="Outgoing-only trust"
          trustSignals={trustSignals}
        />
        <CircleColumn
          empty="No mutual trust detected."
          members={keepMembers}
          onSelect={onSelectMember}
          onToggleCleanup={onToggleCleanup}
          profiles={profiles}
          selectedCleanupIds={selectedCleanupIds}
          selectedMemberId={selectedMemberId}
          title="Mutual"
          trustSignals={trustSignals}
        />
        <CircleColumn
          empty="No incoming trust without return."
          members={incomingMembers}
          onSelect={onSelectMember}
          onToggleCleanup={onToggleCleanup}
          profiles={profiles}
          selectedCleanupIds={selectedCleanupIds}
          selectedMemberId={selectedMemberId}
          title="Incoming-only trust"
          trustSignals={trustSignals}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="border-ink/15 bg-white/70 hover:border-marine/30 hover:bg-white"
          disabled={reviewMembers.length === 0}
          onClick={onSelectAll}
        >
          Select all outgoing-only untrusts
        </Button>
        <Button
          type="button"
          variant="outline"
          className="border-ink/15 bg-white/70 hover:border-citrus/30 hover:bg-white"
          disabled={selectedRows.length === 0}
          onClick={onClear}
        >
          Clear selection
        </Button>
      </div>

      <div className="mt-4">
        <CleanupBar
          onClear={onClear}
          onPrepare={onPrepare}
          profiles={profiles}
          selectedRows={selectedRows}
          trustSignals={trustSignals}
        />
      </div>
    </section>
  );
}

function JsonPanel({
  title,
  count,
  value,
}: {
  title: string;
  count?: number;
  value: unknown;
}) {
  return (
    <Card className="trust-panel-soft min-h-0">
      <CardHeader className="border-b border-ink/10 pb-3">
        <CardTitle className="flex items-center justify-between gap-3 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink/70">
            {title}
          </span>
          {typeof count === "number" ? (
            <Badge className="border-marine/20 bg-marine/10 text-marine" variant="outline">
              {count}
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="max-h-96 overflow-auto rounded-md border border-ink/10 bg-sand/80 p-3 font-mono text-xs leading-relaxed text-ink/70">
          {formatJson(value)}
        </pre>
      </CardContent>
    </Card>
  );
}

export function TrustGraphReader() {
  const { address, isConnected, isMiniappHost } = useWallet();
  const auth = useAuthSession();
  const [targetAddress, setTargetAddress] = useState(DEFAULT_LAUNCH_ADDRESS);
  const [profileSearchResults, setProfileSearchResults] = useState<ProfileSearchResult[]>([]);
  const [profileSearchLoading, setProfileSearchLoading] = useState(false);
  const [profileSearchOpen, setProfileSearchOpen] = useState(false);
  const [result, setResult] = useState<TrustGraphResult | null>(null);
  const [profiles, setProfiles] = useState<Record<string, CirclesProfile>>({});
  const [trustSignals, setTrustSignals] = useState<Record<string, TrustSignal>>({});
  const [selectedCleanupIds, setSelectedCleanupIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [cleanupPreviewOpen, setCleanupPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (auth.address) {
      queueMicrotask(() => setTargetAddress(auth.address ?? ""));
      return;
    }
    if (address) queueMicrotask(() => setTargetAddress(address));
  }, [address, auth.address]);

  useEffect(() => {
    if (address) return;
    const param = new URLSearchParams(window.location.search).get("address");
    const normalizedParam = param ? normalizeAddress(param) : null;
    const launchAddress = normalizedParam ?? DEFAULT_LAUNCH_ADDRESS;
    queueMicrotask(() => {
      setTargetAddress(param && normalizedParam ? param : DEFAULT_LAUNCH_ADDRESS);
      void readGraph(launchAddress);
    });
    // This hydrates standalone links such as /?address=0x..., otherwise the launch default.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const normalizedTarget = useMemo(
    () => normalizeAddress(targetAddress) ?? "",
    [targetAddress],
  );
  const searchTerm = targetAddress.trim();
  const canSearchProfile = searchTerm.length >= 2 && !normalizedTarget;
  const canRead =
    Boolean(normalizedTarget || canSearchProfile) &&
    !loading &&
    !profileSearchLoading;

  useEffect(() => {
    const term = targetAddress.trim();
    if (normalizeAddress(term) || term.length < 2) {
      queueMicrotask(() => {
        setProfileSearchResults([]);
        setProfileSearchOpen(false);
        setProfileSearchLoading(false);
      });
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setProfileSearchLoading(true);
      void fetch(`/api/profiles/search?q=${encodeURIComponent(term)}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) return { results: [] };
          return (await response.json()) as { results?: ProfileSearchResult[] };
        })
        .then((data) => {
          setProfileSearchResults(data.results ?? []);
          setProfileSearchOpen(true);
        })
        .catch(() => {
          if (!controller.signal.aborted) setProfileSearchResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setProfileSearchLoading(false);
        });
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [targetAddress]);

  async function readGraph(
    addressToRead = normalizedTarget,
    options: { resetCleanup?: boolean } = {},
  ) {
    const normalized = normalizeAddress(addressToRead);
    if (!normalized) {
      setError("Enter a valid Circles wallet address.");
      return false;
    }
    const resetCleanup = options.resetCleanup ?? true;

    setLoading(true);
    setError(null);
    if (resetCleanup) {
      setSelectedCleanupIds(new Set());
      setSelectedMemberId(null);
      setCleanupPreviewOpen(false);
    }

    const startedAt = Date.now();
    try {
      const { Sdk } = await import("@aboutcircles/sdk");
      const sdk = new Sdk();
      const avatar = normalized as `0x${string}`;
      const rawRelationsQuery = sdk.rpc.trust.getTrustRelations(
        avatar,
        50,
        "DESC",
      );

      const [trusts, trustedBy, mutualTrusts] = await Promise.all([
        sdk.rpc.trust.getTrusts(avatar),
        sdk.rpc.trust.getTrustedBy(avatar),
        sdk.rpc.trust.getMutualTrusts(avatar),
      ]);

      await rawRelationsQuery.queryNextPage();
      const rawPage = rawRelationsQuery.currentPage;
      const rawResults = rawPage?.results ?? [];

      setResult({
        address: normalized,
        counts: {
          trusts: trusts.length,
          trustedBy: trustedBy.length,
          mutualTrusts: mutualTrusts.length,
          rawRelations: rawResults.length,
        },
        trusts: jsonSafe(trusts) as unknown[],
        trustedBy: jsonSafe(trustedBy) as unknown[],
        mutualTrusts: jsonSafe(mutualTrusts) as unknown[],
        rawRelationsPage: jsonSafe({
          limit: rawPage?.limit ?? 50,
          size: rawPage?.size ?? 0,
          hasMore: rawPage?.hasMore ?? false,
          results: rawResults,
        }) as RawRelationsPage,
        fetchedAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedAt,
      });
      return true;
    } catch (err) {
      setResult(null);
      setError(
        err instanceof Error ? err.message : "Unable to fetch trust graph.",
      );
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function readSearchTarget() {
    const normalized = normalizeAddress(targetAddress);
    if (normalized) {
      setProfileSearchOpen(false);
      await readGraph(normalized);
      return;
    }

    const term = targetAddress.trim();
    if (term.length < 2) {
      setError("Enter a Circles wallet address or profile name.");
      return;
    }

    setProfileSearchLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/profiles/search?q=${encodeURIComponent(term)}`,
        { cache: "no-store" },
      );
      const data = response.ok
        ? ((await response.json()) as { results?: ProfileSearchResult[] })
        : { results: [] };
      const firstResult = data.results?.[0];
      if (!firstResult) {
        setError("No Circles profile found for this name.");
        setProfileSearchOpen(false);
        return;
      }
      selectProfileResult(firstResult);
    } catch {
      setError("Unable to search Circles profiles.");
    } finally {
      setProfileSearchLoading(false);
    }
  }

  function selectProfileResult(profile: ProfileSearchResult) {
    const normalized = normalizeAddress(profile.address);
    if (!normalized) return;

    setTargetAddress(profile.address);
    setProfileSearchOpen(false);
    setProfileSearchResults([]);
    setProfiles((current) => ({
      ...current,
      [normalized]: {
        name: profile.name,
        imageUrl: profile.imageUrl,
      },
    }));
    void readGraph(normalized);
  }

  useEffect(() => {
    if (auth.address) {
      void readGraph(auth.address);
      return;
    }
    if (address) void readGraph(address);
    // The host wallet address is the trigger; readGraph reads the explicit argument.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, auth.address]);

  const lastFetch = result
    ? `${new Date(result.fetchedAt).toLocaleTimeString()} (${result.elapsedMs} ms)`
    : "Not loaded";
  const cleanerAnalysis = useMemo(() => buildCleanerAnalysis(result), [result]);
  const cleanupCandidates = useMemo(
    () =>
      [...cleanerAnalysis.outgoingOnly].sort((left, right) => {
        const priority =
          cleanupPriority(trustSignals[left.address]) -
          cleanupPriority(trustSignals[right.address]);
        if (priority !== 0) return priority;
        const leftScore = trustSignals[left.address]?.trustScore ?? -1;
        const rightScore = trustSignals[right.address]?.trustScore ?? -1;
        return leftScore - rightScore;
      }),
    [cleanerAnalysis.outgoingOnly, trustSignals],
  );
  const profileAddresses = useMemo(() => {
    const addresses = new Set<string>();
    if (result?.address) addresses.add(result.address);
    for (const row of [
      ...cleanerAnalysis.outgoingOnly,
      ...cleanerAnalysis.incomingOnly,
      ...cleanerAnalysis.mutual,
      ...cleanerAnalysis.rawSample,
    ]) {
      addresses.add(row.address);
    }
    return Array.from(addresses);
  }, [cleanerAnalysis, result?.address]);

  useEffect(() => {
    const missing = profileAddresses.filter((profileAddress) => !profiles[profileAddress]);
    if (!missing.length) return;

    const controller = new AbortController();
    void fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addresses: missing }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as {
          profiles?: Record<string, CirclesProfile>;
        };
      })
      .then((data) => {
        if (!data?.profiles) return;
        setProfiles((current) => ({ ...current, ...data.profiles }));
      })
      .catch(() => {});

    return () => controller.abort();
  }, [profileAddresses, profiles]);

  useEffect(() => {
    const missing = profileAddresses.filter(
      (profileAddress) => !trustSignals[profileAddress],
    );
    if (!missing.length) return;

    const controller = new AbortController();
    void fetch("/api/trust-scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addresses: missing }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as {
          trustProfiles?: Record<string, TrustSignal>;
        };
      })
      .then((data) => {
        if (!data?.trustProfiles) return;
        setTrustSignals((current) => ({ ...current, ...data.trustProfiles }));
      })
      .catch(() => {});

    return () => controller.abort();
  }, [profileAddresses, trustSignals]);
  const activeProfile = result?.address ? profiles[result.address] : null;
  const activeSignal = result?.address ? trustSignals[result.address] : null;

  function toggleCleanupCandidate(id: string) {
    setSelectedCleanupIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setCleanupPreviewOpen(false);
  }

  function selectAllCleanupCandidates() {
    setSelectedCleanupIds(new Set(cleanupCandidates.map(cleanupRowId)));
    setCleanupPreviewOpen(false);
  }

  function clearCleanupSelection() {
    setSelectedCleanupIds(new Set());
    setCleanupPreviewOpen(false);
  }

  function rememberSearchProfile(profile: ProfileSearchResult) {
    const normalized = normalizeAddress(profile.address);
    if (!normalized) return;
    setProfiles((current) => ({
      ...current,
      [normalized]: {
        name: profile.name,
        imageUrl: profile.imageUrl,
      },
    }));
  }

  function loadSearchProfile(profile: ProfileSearchResult) {
    const normalized = normalizeAddress(profile.address);
    if (!normalized) return;
    rememberSearchProfile(profile);
    setTargetAddress(profile.address);
    setProfileSearchOpen(false);
    void readGraph(normalized);
  }

  function selectCircleMember(member: CircleMember) {
    setSelectedMemberId(circleMemberId(member));
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <section
        className={`trust-panel relative overflow-visible rounded-lg p-4 sm:p-5 ${
          profileSearchOpen && canSearchProfile ? "z-50" : "z-10"
        }`}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                className={
                  isMiniappHost
                    ? "bg-marine text-white hover:bg-marine"
                    : "border-ink/15 bg-white/60 text-ink"
                }
                variant={isMiniappHost ? "default" : "outline"}
              >
                {isMiniappHost ? "Circles host" : "Standalone"}
              </Badge>
              <Badge
                className={
                  isConnected
                    ? "bg-citrus/12 text-citrus hover:bg-citrus/12"
                    : "border-ink/15 bg-white/60 text-ink/70"
                }
                variant={isConnected ? "secondary" : "outline"}
              >
                {address ? shortenAddress(address) : "No wallet"}
              </Badge>
              <Badge
                className={
                  auth.isAuthenticated
                    ? "bg-marine/10 text-marine hover:bg-marine/10"
                    : "border-ink/15 bg-white/60 text-ink/70"
                }
                variant={auth.isAuthenticated ? "secondary" : "outline"}
              >
                {auth.address ? `Verified ${shortenAddress(auth.address)}` : "Not verified"}
              </Badge>
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-ink">
                Trust Cleaner
              </h1>
              <p className="max-w-2xl text-sm text-ink/65">
                Review outgoing, incoming, mutual and raw Circles trust
                relations from one compact surface.
              </p>
              {result?.address ? (
                <ProfileIdentity
                  address={result.address}
                  profile={activeProfile}
                  signal={activeSignal}
                />
              ) : null}
            </div>
          </div>

          <div className="relative z-50 flex w-full flex-col gap-2 lg:max-w-2xl lg:flex-row">
            <div className="relative z-50 min-w-0 flex-1">
              <input
                value={targetAddress}
                onChange={(event) => {
                  setTargetAddress(event.target.value);
                  setProfileSearchOpen(true);
                }}
                onFocus={() => {
                  if (canSearchProfile || profileSearchResults.length) {
                    setProfileSearchOpen(true);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void readSearchTarget();
                  }
                  if (event.key === "Escape") setProfileSearchOpen(false);
                }}
                aria-label="Address or profile search"
                placeholder="0x or Circles name..."
                className="h-10 w-full min-w-0 rounded-lg border border-ink/15 bg-white/80 px-3 text-sm text-ink shadow-sm outline-none transition placeholder:text-ink/35 focus-visible:border-marine/40 focus-visible:ring-3 focus-visible:ring-marine/20"
              />
              {profileSearchOpen && canSearchProfile ? (
                <div className="mt-2 overflow-hidden rounded-lg border border-ink/12 bg-white shadow-xl shadow-ink/10 lg:absolute lg:left-0 lg:right-0 lg:top-[calc(100%+0.5rem)] lg:z-[80] lg:mt-0">
                  {profileSearchLoading ? (
                    <div className="flex items-center gap-2 px-3 py-3 text-sm text-ink/60">
                      <RefreshCw className="size-4 animate-spin" />
                      Searching profiles...
                    </div>
                  ) : profileSearchResults.length ? (
                    <div className="max-h-72 overflow-auto p-1.5">
                      {profileSearchResults.map((searchResult) => (
                        <button
                          key={searchResult.address}
                          type="button"
                          className="flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left transition hover:bg-marine/10 focus-visible:bg-marine/10 focus-visible:outline-none"
                          onClick={() => selectProfileResult(searchResult)}
                        >
                          <ProfileAvatar
                            address={searchResult.address}
                            profile={searchResult}
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-ink">
                              {searchResult.name}
                            </span>
                            <span className="block truncate text-xs text-ink/55">
                              {shortenAddress(searchResult.address)}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="px-3 py-3 text-sm text-ink/60">
                      No profile found.
                    </div>
                  )}
                </div>
              ) : null}
            </div>
            <div className="relative z-0 flex flex-wrap gap-2">
              {auth.address ? (
                <Button
                  type="button"
                  variant="outline"
                  className="border-ink/15 bg-white/70 hover:border-marine/30 hover:bg-white"
                  onClick={() => setTargetAddress(auth.address ?? "")}
                >
                  <ShieldCheck className="size-4" />
                  Use verified
                </Button>
              ) : null}
              {address ? (
                <Button
                  type="button"
                  variant="outline"
                  className="border-ink/15 bg-white/70 hover:border-marine/30 hover:bg-white"
                  onClick={() => setTargetAddress(address)}
                >
                  <ShieldCheck className="size-4" />
                  Use wallet
                </Button>
              ) : null}
              <Button
                type="button"
                onClick={() => void readSearchTarget()}
                disabled={!canRead}
              >
                {loading || profileSearchLoading ? (
                  <RefreshCw className="size-4 animate-spin" />
                ) : (
                  <Search className="size-4" />
                )}
                {loading
                  ? "Reading"
                  : profileSearchLoading
                    ? "Searching"
                    : normalizedTarget
                      ? "Read graph"
                      : "Find profile"}
              </Button>
              {auth.isAuthenticated ? (
                <Button
                  type="button"
                  variant="outline"
                  className="border-ink/15 bg-white/70 hover:border-citrus/30 hover:bg-white"
                  onClick={() => void auth.logout()}
                >
                  <LogOut className="size-4" />
                  Logout
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  className="bg-citrus text-white hover:bg-citrus/90"
                  onClick={auth.openLogin}
                  disabled={auth.loading}
                >
                  <LogIn className="size-4" />
                  Authenticate
                </Button>
              )}
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-citrus/30 bg-citrus/10 p-3 text-sm text-citrus">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <CountTile
          icon={<ArrowUpRight className="size-4" />}
          label="Trusts"
          tone="marine"
          value={result?.counts.trusts ?? "-"}
        />
        <CountTile
          icon={<ArrowDownLeft className="size-4" />}
          label="Trusted by"
          tone="citrus"
          value={result?.counts.trustedBy ?? "-"}
        />
        <CountTile
          icon={<UsersRound className="size-4" />}
          label="Mutual"
          tone="sage"
          value={result?.counts.mutualTrusts ?? "-"}
        />
        <CountTile
          icon={<RefreshCw className="size-4" />}
          info="Raw relations returned by the Circles SDK on the first diagnostic page. This mainly verifies the read, not the cleaning decision on its own."
          label="Raw relations"
          tone="amber"
          value={result?.counts.rawRelations ?? "-"}
        />
        <CountTile
          icon={<ShieldCheck className="size-4" />}
          info="Time of the latest data fetch from Circles for the displayed address."
          label="Last fetch"
          tone="ink"
          value={lastFetch}
        />
      </section>

      <TrustCircleManager
        analysis={cleanerAnalysis}
        onClear={clearCleanupSelection}
        onLoadProfile={loadSearchProfile}
        onPrepare={() => setCleanupPreviewOpen(true)}
        onRememberProfile={rememberSearchProfile}
        onRefreshGraph={() =>
          result?.address
            ? readGraph(result.address, { resetCleanup: false })
            : Promise.resolve(false)
        }
        onSelectAll={selectAllCleanupCandidates}
        onSelectMember={selectCircleMember}
        onToggleCleanup={toggleCleanupCandidate}
        previewOpen={cleanupPreviewOpen}
        profiles={profiles}
        readVersion={result?.fetchedAt ?? null}
        selectedCleanupIds={selectedCleanupIds}
        selectedMemberId={selectedMemberId}
        sourceAddress={result?.address ?? null}
        trustSignals={trustSignals}
      />

      {false ? (
        <>
          <CleanerAnalysisPanel
            analysis={cleanerAnalysis}
            profiles={profiles}
            trustSignals={trustSignals}
          />
          <CriteriaPanel
            candidates={cleanupCandidates}
            trustSignals={trustSignals}
          />
          <CleanupPlanPanel
            candidates={cleanupCandidates}
            onClear={clearCleanupSelection}
            onPrepare={() => setCleanupPreviewOpen(true)}
            onSelectAll={selectAllCleanupCandidates}
            onToggle={toggleCleanupCandidate}
            previewOpen={cleanupPreviewOpen}
            profiles={profiles}
            selectedIds={selectedCleanupIds}
            trustSignals={trustSignals}
          />
        </>
      ) : null}

      <details className="trust-panel-soft rounded-lg p-4">
        <summary className="cursor-pointer text-sm font-semibold text-ink">
          Donnees avancees / raw SDK
        </summary>
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <JsonPanel
            title="trusts"
            count={result?.trusts.length}
            value={result?.trusts ?? []}
          />
          <JsonPanel
            title="trustedBy"
            count={result?.trustedBy.length}
            value={result?.trustedBy ?? []}
          />
          <JsonPanel
            title="mutualTrusts"
            count={result?.mutualTrusts.length}
            value={result?.mutualTrusts ?? []}
          />
        </div>
        <div className="mt-4">
          <JsonPanel
            title="getTrustRelations first page"
            count={result?.rawRelationsPage.results.length}
            value={result?.rawRelationsPage ?? null}
          />
        </div>
      </details>
    </div>
  );
}
