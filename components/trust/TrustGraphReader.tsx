"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  Gauge,
  ListChecks,
  LogIn,
  LogOut,
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
  name?: string;
  imageUrl?: string | null;
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

type CircleBucket = "keep" | "review" | "incoming";

type CircleMember = RelationRow & {
  bucket: CircleBucket;
};

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const DEFAULT_LAUNCH_ADDRESS = "0x158a0EC28264d37b6471736f29e8F68F0C927ed5";

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
  return signal.trustLevel
    ? `Trust ${signal.trustScore} / ${signal.trustLevel}`
    : `Trust ${signal.trustScore}`;
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
  if (band === "low") return "Score membre faible";
  if (band === "medium") return "Score membre moyen";
  if (band === "strong") return "Score membre fort";
  return "Score indisponible";
}

function cleanupHint(signal?: TrustSignal | null) {
  const band = trustBand(signal);
  if (band === "low") return "Priorite de revue";
  if (band === "medium") return "Verifier contexte";
  if (band === "strong") return "Retirer avec prudence";
  return "Revue manuelle";
}

function decisionToneClass(tone: "amber" | "citrus" | "marine" | "sage") {
  if (tone === "sage") return "border-sage/25 bg-sage/10 text-sage";
  if (tone === "amber") return "border-amber/25 bg-amber/10 text-amber";
  if (tone === "citrus") return "border-citrus/25 bg-citrus/10 text-citrus";
  return "border-marine/20 bg-marine/10 text-marine";
}

function circleBucketLabel(bucket: CircleBucket) {
  if (bucket === "keep") return "Mutuel";
  if (bucket === "review") return "Trust sortant seul";
  return "Trust entrant seul";
}

function circleBucketTone(bucket: CircleBucket) {
  if (bucket === "keep") return "border-sage/25 bg-sage/10 text-sage";
  if (bucket === "review") return "border-citrus/25 bg-citrus/10 text-citrus";
  return "border-marine/20 bg-marine/10 text-marine";
}

function relationSentence(member: CircleMember, name: string) {
  if (member.bucket === "keep") {
    return `Trust mutuel: vous acceptez chacun les CRC de l'autre.`;
  }
  if (member.bucket === "review") {
    return `Tu acceptes les CRC de ${name}, sans trust retour detecte.`;
  }
  return `${name} accepte tes CRC; toi, tu ne prends pas de risque sortant.`;
}

function hasPositiveFlow(value: string) {
  try {
    return BigInt(value) > 0n;
  } catch {
    return false;
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
  const network = signal ? `${signal.inDegree} in / ${signal.outDegree} out` : "reseau en chargement";

  if (member.bucket === "keep") {
    return {
      action: "Aucune action de nettoyage recommandee.",
      factors: [
        "Relation bidirectionnelle directe",
        `${mutuals} mutuals detectes`,
        `Reseau: ${network}`,
      ],
      label: "Garder",
      summary:
        "Ce trust mutuel aide la circulation des CRC. A conserver sauf si la relation sociale n'est plus fiable.",
      tone: "sage" as const,
    };
  }

  if (member.bucket === "incoming") {
    return {
      action: "Pas d'action sortante: tu ne trust pas ce profil.",
      factors: [
        `${name} accepte tes CRC`,
        "Aucun engagement sortant de ta part",
        `Score observe: ${score}`,
      ],
      label: "Pas d'action",
      summary:
        "Cette relation peut aider la reception vers toi, sans te faire accepter ses CRC.",
      tone: "marine" as const,
    };
  }

  const urgent = band === "low" || band === "unknown";
  return {
    action: "Verifier si tu connais vraiment ce profil et si tu veux accepter ses CRC.",
    factors: [
      "Engagement sortant actif",
      "Pas de trust retour direct",
      `Score observe: ${score}`,
    ],
    label: urgent ? "Revoir en priorite" : "Revoir contexte",
    summary:
      "Tu acceptes ses CRC dans ton economie. Sans retour direct, ce trust doit etre volontaire et justifie.",
    tone: urgent ? ("citrus" as const) : ("amber" as const),
  };
}

function CountTile({
  icon,
  label,
  tone = "marine",
  value,
}: {
  icon: ReactNode;
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
        <span className="text-xs font-semibold uppercase tracking-wide text-ink/55">
          {label}
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

  return (
    <div className="mt-3 flex min-w-0 items-center gap-3 rounded-lg border border-ink/10 bg-white/45 px-3 py-2">
      <ProfileAvatar address={address} profile={profile} size="md" />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-ink">
          {name || "Circles profile"}
        </div>
        <div className="truncate text-xs text-ink/55">
          {shortenAddress(address)} - <TrustSignalMeta signal={signal} />
        </div>
      </div>
      <div className="ml-auto hidden shrink-0 sm:block">
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
              Cleanup plan
            </h2>
            <Badge className="border-citrus/25 bg-citrus/10 text-citrus" variant="outline">
              Dry run only
            </Badge>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-ink/65">
            Select outgoing-only trust relations to prepare a cleanup preview.
          </p>
        </div>
        <div className="rounded-lg border border-ink/10 bg-white/50 px-3 py-2 text-sm font-semibold text-ink">
          {selectedRows.length} selected / {candidates.length} candidates
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-ink/10 bg-white/35 p-3">
        {!hasCandidates ? (
          <div className="flex flex-col gap-2 rounded-lg border border-dashed border-ink/15 bg-white/40 p-4 text-sm text-ink/60">
            <span className="font-semibold text-ink">No cleanup candidate yet.</span>
            <span>
              This wallet has no outgoing-only trust in the loaded SDK lists, so
              Trust Cleaner will not propose a removal action.
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
                    aria-label={`Select cleanup for ${name}`}
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
            Prepare cleanup
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
            aria-label={`Mark ${name} for cleanup`}
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
                {shortenAddress(member.address)}
              </div>
            </div>
            <Badge className={circleBucketTone(member.bucket)} variant="outline">
              {circleBucketLabel(member.bucket)}
            </Badge>
          </div>
          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-ink/65">
            {relationSentence(member, name)}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <TrustSignalBadge signal={signal} compact />
            {isReview ? (
              <Badge className={trustBandTone(trustBand(signal))} variant="outline">
                {cleanupHint(signal)}
              </Badge>
            ) : null}
          </div>
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

function FlowPathPanel({ pathfinder }: { pathfinder: PathfinderState }) {
  if (pathfinder.status === "idle") return null;

  if (pathfinder.status === "loading") {
    return (
      <div className="rounded-lg border border-ink/10 bg-white/55 p-3 text-sm text-ink/60">
        <div className="flex items-center gap-2 font-medium text-ink">
          <RefreshCw className="size-4 animate-spin" />
          Calcul du chemin de circulation
        </div>
      </div>
    );
  }

  if (pathfinder.status === "error") {
    return (
      <div className="rounded-lg border border-citrus/25 bg-citrus/10 p-3 text-sm text-citrus">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{pathfinder.error}</span>
        </div>
      </div>
    );
  }

  const { preview } = pathfinder;
  const flowPossible = hasPositiveFlow(preview.maxFlow);
  const visibleTransfers = preview.transfers.slice(0, 4);

  return (
    <div className="rounded-lg border border-ink/10 bg-white/55 p-3 text-sm text-ink/65">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink/45">
          Chemin de circulation
        </div>
        <Badge
          className={
            flowPossible
              ? "border-sage/25 bg-sage/10 text-sage"
              : "border-citrus/25 bg-citrus/10 text-citrus"
          }
          variant="outline"
        >
          {flowPossible ? "Flux possible" : "Aucun flux"}
        </Badge>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-md bg-sand/70 px-2.5 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">
            Max flow
          </div>
          <div className="font-semibold text-ink">
            {preview.maxFlowCrc} CRC
          </div>
        </div>
        <div className="rounded-md bg-sand/70 px-2.5 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">
            Test 1 CRC
          </div>
          <div className="font-semibold text-ink">
            {preview.requestedFlowCrc} / {preview.targetFlowCrc}
          </div>
        </div>
        <div className="rounded-md bg-sand/70 px-2.5 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">
            Hops
          </div>
          <div className="font-semibold text-ink">
            {preview.transfers.length} / {preview.maxTransfers}
          </div>
        </div>
      </div>

      {visibleTransfers.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {visibleTransfers.map((transfer, index) => (
            <div
              key={`${transfer.from}:${transfer.to}:${transfer.tokenOwner}:${index}`}
              className="flex flex-wrap items-center gap-2 rounded-md border border-ink/10 bg-white/55 px-2.5 py-2 text-xs"
            >
              <span className="font-medium text-ink">{shortenAddress(transfer.from)}</span>
              <ArrowUpRight className="size-3.5 text-marine" />
              <span className="font-medium text-ink">{shortenAddress(transfer.to)}</span>
              <span className="text-ink/45">via</span>
              <span className="font-medium text-ink">{shortenAddress(transfer.tokenOwner)}</span>
              <span className="ml-auto text-ink/55">{transfer.valueCrc} CRC</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded-md bg-sand/70 px-2.5 py-2 text-xs text-ink/60">
          Pathfinder ne trouve pas de route utilisable avec les balances actuelles.
        </p>
      )}
    </div>
  );
}

function MemberDetailPanel({
  member,
  onToggleCleanup,
  pathfinder,
  profile,
  selectedForCleanup,
  signal,
}: {
  member: CircleMember | null;
  onToggleCleanup: (id: string) => void;
  pathfinder: PathfinderState;
  profile?: CirclesProfile | null;
  selectedForCleanup: boolean;
  signal?: TrustSignal | null;
}) {
  if (!member) {
    return (
      <aside className="rounded-lg border border-dashed border-ink/15 bg-white/35 p-4 text-sm text-ink/60">
        Selectionne une personne pour voir la relation, les criteres et la
        decision possible.
      </aside>
    );
  }

  const name = profile?.name?.trim() || shortenAddress(member.address);
  const isReview = member.bucket === "review";
  const decision = buildTrustDecision(member, signal, name);

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
                {shortenAddress(member.address)}
              </div>
            </div>
            <Badge className={circleBucketTone(member.bucket)} variant="outline">
              {circleBucketLabel(member.bucket)}
            </Badge>
          </div>

          <p className="rounded-lg border border-ink/10 bg-sand/60 p-3 text-sm leading-relaxed text-ink/70">
            {relationSentence(member, name)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-ink/10 bg-white/55 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink/45">
              Score membre
            </div>
            <div className="mt-1 text-sm font-semibold text-ink">
              {scoreLabel(signal)}
            </div>
          </div>
          <div className="rounded-lg border border-ink/10 bg-white/55 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink/45">
              Mutuals
            </div>
            <div className="mt-1 text-sm font-semibold text-ink">
              {signal?.mutualCount ?? 0}
            </div>
          </div>
          <div className="rounded-lg border border-ink/10 bg-white/55 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink/45">
              Reseau
            </div>
            <div className="mt-1 text-sm font-semibold text-ink">
              {signal ? `${signal.inDegree} in / ${signal.outDegree} out` : "Loading"}
            </div>
          </div>
          <div className="rounded-lg border border-ink/10 bg-white/55 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink/45">
              Anciennete
            </div>
            <div className="mt-1 text-sm font-semibold text-ink">
              {signal ? `${signal.ageDays} days` : "Loading"}
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink/45">
              Decision trust
            </div>
            <Badge className={decisionToneClass(decision.tone)} variant="outline">
              {decision.label}
            </Badge>
          </div>
          <div className="rounded-lg border border-ink/10 bg-white/55 p-3 text-sm leading-relaxed text-ink/65">
            <p>{decision.summary}</p>
            <div className="mt-3 grid gap-1.5 text-xs text-ink/55">
              {decision.factors.map((factor) => (
                <div key={factor} className="flex items-start gap-2">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-marine/45" />
                  <span>{factor}</span>
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
              {selectedForCleanup ? "Retirer du plan" : "Marquer pour retrait"}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-3">
        <FlowPathPanel pathfinder={pathfinder} />
      </div>
    </aside>
  );
}

function CleanupBar({
  onClear,
  onPrepare,
  selectedRows,
}: {
  onClear: () => void;
  onPrepare: () => void;
  selectedRows: CircleMember[];
}) {
  if (selectedRows.length === 0) return null;

  return (
    <div className="sticky bottom-3 z-20 rounded-lg border border-marine/20 bg-ink px-4 py-3 text-white shadow-xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold">
            {selectedRows.length} marque{selectedRows.length > 1 ? "s" : ""} pour retrait
          </div>
          <div className="text-xs text-white/65">
            Dry-run uniquement. Aucune transaction ne part depuis cet ecran.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onClear}>
            Clear
          </Button>
          <Button type="button" onClick={onPrepare}>
            <ClipboardCheck className="size-4" />
            Voir le plan
          </Button>
        </div>
      </div>
    </div>
  );
}

function PreparedPlan({
  profiles,
  selectedRows,
  trustSignals,
}: {
  profiles: Record<string, CirclesProfile>;
  selectedRows: CircleMember[];
  trustSignals: Record<string, TrustSignal>;
}) {
  if (selectedRows.length === 0) return null;

  return (
    <div className="rounded-lg border border-marine/15 bg-marine/5 p-3">
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-marine/10 p-1.5 text-marine">
          <Trash2 className="size-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-ink">Plan prepare</h3>
          <p className="text-xs text-ink/60">
            Preview only. No transaction has been sent.
          </p>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {selectedRows.map((member) => {
          const profile = profiles[member.address];
          const name = profile?.name?.trim() || shortenAddress(member.address);
          const signal = trustSignals[member.address];
          return (
            <div
              key={circleMemberId(member)}
              className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white/60 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <ProfileAvatar address={member.address} profile={profile} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-ink">
                    {name}
                  </div>
                  <div className="truncate text-xs text-ink/55">
                    {shortenAddress(member.address)} - removeTrust
                  </div>
                </div>
              </div>
              <Badge className={trustBandTone(trustBand(signal))} variant="outline">
                {cleanupReason(signal)}
              </Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TrustCircleManager({
  analysis,
  onClear,
  onLoadProfile,
  onPrepare,
  onRememberProfile,
  onSelectAll,
  onSelectMember,
  onToggleCleanup,
  previewOpen,
  profiles,
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
  onSelectAll: () => void;
  onSelectMember: (member: CircleMember) => void;
  onToggleCleanup: (id: string) => void;
  previewOpen: boolean;
  profiles: Record<string, CirclesProfile>;
  selectedCleanupIds: Set<string>;
  selectedMemberId: string | null;
  sourceAddress: string | null;
  trustSignals: Record<string, TrustSignal>;
}) {
  const keepMembers = analysis.mutual.map((row) => ({
    ...row,
    bucket: "keep" as const,
  }));
  const reviewMembers = analysis.outgoingOnly
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
    });
  const incomingMembers = analysis.incomingOnly.map((row) => ({
    ...row,
    bucket: "incoming" as const,
  }));
  const allMembers = [...reviewMembers, ...keepMembers, ...incomingMembers];
  const detailMember =
    allMembers.find((member) => circleMemberId(member) === selectedMemberId) ??
    allMembers[0] ??
    null;
  const detailAddress = detailMember?.address ?? "";
  const selectedRows = reviewMembers.filter((member) =>
    selectedCleanupIds.has(cleanupRowId(member)),
  );
  const [pathfinderState, setPathfinderState] = useState<PathfinderState>({
    status: "idle",
  });
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
    if (!sourceAddress || !detailAddress) {
      queueMicrotask(() => setPathfinderState({ status: "idle" }));
      return;
    }

    const controller = new AbortController();
    queueMicrotask(() => setPathfinderState({ status: "loading" }));
    void fetch("/api/pathfinder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: sourceAddress,
        to: detailAddress,
        targetFlow: "1000000000000000000",
        useWrappedBalances: true,
        maxTransfers: 4,
      }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("pathfinder unavailable");
        }
        return (await response.json()) as PathfinderPreview;
      })
      .then((preview) => {
        setPathfinderState({ status: "ready", preview });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setPathfinderState({
          status: "error",
          error: "Chemin de circulation indisponible pour ce profil.",
        });
      });

    return () => controller.abort();
  }, [detailAddress, sourceAddress]);

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
      title: `${profile.name} n'est pas dans ce cercle`,
      description:
        "Ce profil existe, mais il n'apparait pas dans les relations chargees. Tu peux ouvrir son propre cercle pour explorer autour de lui.",
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
        title: "Pas dans ce cercle",
        description:
          matches.length > 0
            ? `${matches.length} profil(s) trouve(s) pour "${term}", mais aucun n'apparait dans le trust graph charge.`
            : `Aucun profil Circles trouve pour "${term}".`,
      });
    } catch {
      setCircleSearchNotice({
        title: "Recherche impossible",
        description: "La recherche profil n'a pas repondu. Reessaie dans un instant.",
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
              Mon cercle
            </h2>
            <Badge className="border-marine/20 bg-marine/10 text-marine" variant="outline">
              Lecture whitepaper
            </Badge>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-ink/65">
            Lis les relations comme des engagements economiques: qui accepte
            quels CRC, et quelle responsabilite sortante tu prends.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-lg border border-ink/10 bg-white/45 p-2 text-center">
          <div className="px-2">
            <div className="text-lg font-semibold text-ink">{keepMembers.length}</div>
            <div className="text-[11px] uppercase tracking-wide text-ink/45">Mutuels</div>
          </div>
          <div className="px-2">
            <div className="text-lg font-semibold text-citrus">{reviewMembers.length}</div>
            <div className="text-[11px] uppercase tracking-wide text-ink/45">Sortants</div>
          </div>
          <div className="px-2">
            <div className="text-lg font-semibold text-marine">{incomingMembers.length}</div>
            <div className="text-[11px] uppercase tracking-wide text-ink/45">Entrants</div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-2 rounded-lg border border-marine/15 bg-marine/5 p-3 text-sm text-ink/70 lg:grid-cols-3">
        <div>
          <span className="font-semibold text-ink">Regle de trust:</span>{" "}
          trust une personne = accepter ses CRC dans ton economie.
        </div>
        <div>
          <span className="font-semibold text-ink">Objectif:</span>{" "}
          auditer tes engagements sortants, pas juger les personnes.
        </div>
        <div>
          <span className="font-semibold text-ink">Priorite:</span>{" "}
          verifier les trusts sortants seuls avant toute action.
        </div>
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
              placeholder="Chercher un pseudo ou une adresse dans ce cercle"
              className="h-10 w-full min-w-0 rounded-lg border border-ink/15 bg-white/80 px-3 pl-9 text-sm text-ink shadow-sm outline-none transition placeholder:text-ink/35 focus-visible:border-marine/40 focus-visible:ring-3 focus-visible:ring-marine/20"
            />
          </div>
          <Button type="submit" disabled={!canSearchCircle}>
            {circleSearchLoading ? (
              <RefreshCw className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
            Situer
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
                            {member ? circleBucketLabel(member.bucket) : "Hors cercle"}
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
                        Situer
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="border-ink/15 bg-white/70 hover:border-marine/30 hover:bg-white"
                        onClick={() => onLoadProfile(profile)}
                      >
                        <Eye className="size-3.5" />
                        Voir son cercle
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
                          {selectedForCleanup ? "Retirer" : "Marquer"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-lg border border-dashed border-ink/15 bg-white/35 p-3 text-sm text-ink/55 md:col-span-2 xl:col-span-3">
                {circleSearchLoading
                  ? "Recherche de profils..."
                  : "Aucun profil trouve pour cette recherche."}
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
              member={detailMember}
              onToggleCleanup={onToggleCleanup}
              pathfinder={pathfinderState}
              profile={profiles[detailMember.address]}
              selectedForCleanup={selectedCleanupIds.has(cleanupRowId(detailMember))}
              signal={trustSignals[detailMember.address]}
            />
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <CircleColumn
          empty="Aucun trust mutuel detecte."
          members={keepMembers}
          onSelect={onSelectMember}
          onToggleCleanup={onToggleCleanup}
          profiles={profiles}
          selectedCleanupIds={selectedCleanupIds}
          selectedMemberId={selectedMemberId}
          title="Mutuels"
          trustSignals={trustSignals}
        />
        <CircleColumn
          empty="Aucun trust sortant sans retour."
          members={reviewMembers}
          onSelect={onSelectMember}
          onToggleCleanup={onToggleCleanup}
          profiles={profiles}
          selectedCleanupIds={selectedCleanupIds}
          selectedMemberId={selectedMemberId}
          title="Trust sortant seul"
          trustSignals={trustSignals}
        />
        <CircleColumn
          empty="Aucun trust entrant sans retour."
          members={incomingMembers}
          onSelect={onSelectMember}
          onToggleCleanup={onToggleCleanup}
          profiles={profiles}
          selectedCleanupIds={selectedCleanupIds}
          selectedMemberId={selectedMemberId}
          title="Trust entrant seul"
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
          Marquer tous les trusts sortants seuls
        </Button>
        <Button
          type="button"
          variant="outline"
          className="border-ink/15 bg-white/70 hover:border-citrus/30 hover:bg-white"
          disabled={selectedRows.length === 0}
          onClick={onClear}
        >
          Clear
        </Button>
      </div>

      {previewOpen ? (
        <div className="mt-4">
          <PreparedPlan
            profiles={profiles}
            selectedRows={selectedRows}
            trustSignals={trustSignals}
          />
        </div>
      ) : null}

      <div className="mt-4">
        <CleanupBar
          onClear={onClear}
          onPrepare={onPrepare}
          selectedRows={selectedRows}
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

  async function readGraph(addressToRead = normalizedTarget) {
    const normalized = normalizeAddress(addressToRead);
    if (!normalized) {
      setError("Enter a valid Circles wallet address.");
      return;
    }

    setLoading(true);
    setError(null);
    setSelectedCleanupIds(new Set());
    setSelectedMemberId(null);
    setCleanupPreviewOpen(false);

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
    } catch (err) {
      setResult(null);
      setError(
        err instanceof Error ? err.message : "Unable to fetch trust graph.",
      );
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
                      Recherche profils...
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
                      Aucun profil trouve.
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
          label="Raw page"
          tone="amber"
          value={result?.counts.rawRelations ?? "-"}
        />
        <CountTile
          icon={<ShieldCheck className="size-4" />}
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
        onSelectAll={selectAllCleanupCandidates}
        onSelectMember={selectCircleMember}
        onToggleCleanup={toggleCleanupCandidate}
        previewOpen={cleanupPreviewOpen}
        profiles={profiles}
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
