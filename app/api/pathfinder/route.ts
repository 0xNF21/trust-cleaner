export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { Sdk } from "@aboutcircles/sdk";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const DEFAULT_TARGET_FLOW = 10n ** 18n;
const DEFAULT_MAX_TRANSFERS = 4;

type TransferStep = {
  from: string;
  to: string;
  tokenOwner: string;
  value: bigint;
};

function normalizeAddress(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return ADDRESS_RE.test(normalized) ? normalized : null;
}

function parsePositiveBigInt(value: unknown, fallback: bigint) {
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  try {
    const parsed = BigInt(value);
    return parsed > 0n ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function formatAttoCrc(value: bigint) {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / DEFAULT_TARGET_FLOW;
  const fraction = absolute % DEFAULT_TARGET_FLOW;
  const fractionText = fraction.toString().padStart(18, "0").slice(0, 4);
  const trimmed = fractionText.replace(/0+$/, "");
  return `${sign}${whole.toString()}${trimmed ? `.${trimmed}` : ""}`;
}

function serializeTransfer(transfer: TransferStep) {
  return {
    from: transfer.from.toLowerCase(),
    to: transfer.to.toLowerCase(),
    tokenOwner: transfer.tokenOwner.toLowerCase(),
    value: transfer.value.toString(),
    valueCrc: formatAttoCrc(transfer.value),
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const from = normalizeAddress(body?.from);
    const to = normalizeAddress(body?.to);
    if (!from || !to) {
      return NextResponse.json(
        { error: "valid from and to addresses required" },
        { status: 400 },
      );
    }

    const targetFlow = parsePositiveBigInt(body?.targetFlow, DEFAULT_TARGET_FLOW);
    const maxTransfers =
      typeof body?.maxTransfers === "number" && body.maxTransfers > 0
        ? Math.min(Math.floor(body.maxTransfers), 8)
        : DEFAULT_MAX_TRANSFERS;
    const useWrappedBalances = body?.useWrappedBalances !== false;
    const sdk = new Sdk();

    const [maxFlow, path] = await Promise.all([
      sdk.rpc.pathfinder.findMaxFlow({
        from: from as `0x${string}`,
        to: to as `0x${string}`,
        useWrappedBalances,
        maxTransfers,
      }),
      sdk.rpc.pathfinder.findPath({
        from: from as `0x${string}`,
        to: to as `0x${string}`,
        targetFlow,
        useWrappedBalances,
        maxTransfers,
      }),
    ]);

    return NextResponse.json({
      from,
      to,
      targetFlow: targetFlow.toString(),
      targetFlowCrc: formatAttoCrc(targetFlow),
      maxFlow: maxFlow.toString(),
      maxFlowCrc: formatAttoCrc(maxFlow),
      requestedFlow: path.maxFlow.toString(),
      requestedFlowCrc: formatAttoCrc(path.maxFlow),
      transfers: path.transfers.map(serializeTransfer),
      useWrappedBalances,
      maxTransfers,
    });
  } catch (error) {
    console.error("Pathfinder error:", error);
    return NextResponse.json(
      { error: "Failed to compute pathfinder route" },
      { status: 500 },
    );
  }
}
