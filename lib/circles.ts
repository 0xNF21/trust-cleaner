const DEFAULT_CIRCLES_RPC_URL = "https://rpc.aboutcircles.com/";
const GNOSIS_RPC_URL = "https://rpc.gnosis.gateway.fm";
const CIRCLES_HUB_ADDRESS = "0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8";
const STREAM_COMPLETED_TOPIC = "0xcfe53a731d24ac31b725405f3dca8a4d23512d3e1ade2359fbbe7982bec0fd42";
const TRANSFER_SINGLE_TOPIC = "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
const DEFAULT_START_BLOCK = "0x2A80000";
const WEI_PER_CRC = BigInt("1000000000000000000");

export type CirclesTransferEvent = {
  transactionHash: string;
  from: string;
  to: string;
  operator: string;
  value: string;
  blockNumber: string;
  timestamp: string;
  transactionIndex: string;
  logIndex: string;
  sender: string;
  authData?: { purpose: string; nonce: string } | null;
};

export const circlesConfig = {
  rpcUrl: process.env.NEXT_PUBLIC_CIRCLES_RPC_URL || DEFAULT_CIRCLES_RPC_URL,
};

export function buildAuthPaymentData(nonce: string) {
  return `trust_cleaner_auth:${nonce}`;
}

export function generateAuthPaymentLink(
  recipientAddress: string,
  nonce: string,
  amountCrc = 1,
) {
  const data = encodeURIComponent(buildAuthPaymentData(nonce));
  return `https://app.gnosis.io/transfer/${recipientAddress}/crc?data=${data}&amount=${amountCrc}`;
}

function normalizeAddress(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return /^0x[a-f0-9]{40}$/.test(normalized) ? normalized : null;
}

function padAddress(addr: string): string {
  const clean = addr.toLowerCase().replace("0x", "");
  return `0x${clean.padStart(64, "0")}`;
}

function crcAmountToWei(amount: number | string): bigint {
  const raw = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) return 0n;
  const [whole, fraction = ""] = raw.split(".");
  const fractionWei = (fraction + "0".repeat(18)).slice(0, 18);
  return BigInt(whole || "0") * WEI_PER_CRC + BigInt(fractionWei || "0");
}

function parseStreamCompletedData(data: string): bigint {
  const dataClean = data.slice(2);
  if (dataClean.length < 192) return 0n;
  const offset2 = parseInt(dataClean.slice(64, 128), 16) * 2;
  const arrayLen = parseInt(dataClean.slice(offset2, offset2 + 64), 16);
  let totalAmount = 0n;
  for (let i = 0; i < arrayLen; i += 1) {
    const start = offset2 + 64 + i * 64;
    totalAmount += BigInt(`0x${dataClean.slice(start, start + 64)}`);
  }
  return totalAmount;
}

async function gnosisRpc(body: unknown) {
  const response = await fetch(GNOSIS_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });

  if (!response.ok) return null;
  const payload = await response.json();
  if (payload?.error) return null;
  return payload;
}

async function fetchStreamCompletedFromChain(
  recipientAddress: string,
): Promise<CirclesTransferEvent[]> {
  const normalized = normalizeAddress(recipientAddress);
  if (!normalized) return [];

  const payload = await gnosisRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "eth_getLogs",
    params: [
      {
        fromBlock: DEFAULT_START_BLOCK,
        toBlock: "latest",
        address: CIRCLES_HUB_ADDRESS,
        topics: [STREAM_COMPLETED_TOPIC, null, null, padAddress(normalized)],
      },
    ],
  });

  const logs: Array<Record<string, string | string[]>> = Array.isArray(payload?.result)
    ? payload.result
    : [];
  return logs
    .map((log: Record<string, string | string[]>) => {
      const topics = Array.isArray(log.topics) ? log.topics : [];
      if (topics.length < 4) return null;
      const operator = `0x${String(topics[1]).slice(26)}`;
      const sender = `0x${String(topics[2]).slice(26)}`;
      const receiver = `0x${String(topics[3]).slice(26)}`;
      const totalAmount = parseStreamCompletedData(String(log.data || "0x"));
      return {
        transactionHash: String(log.transactionHash || ""),
        from: sender.toLowerCase(),
        to: receiver.toLowerCase(),
        operator: operator.toLowerCase(),
        value: totalAmount.toString(),
        blockNumber: String(log.blockNumber || ""),
        timestamp: "",
        transactionIndex: String(log.transactionIndex || ""),
        logIndex: String(log.logIndex || ""),
        sender: sender.toLowerCase(),
      } satisfies CirclesTransferEvent;
    })
    .filter((event): event is CirclesTransferEvent => Boolean(event));
}

async function fetchTransferSingleFromChain(
  recipientAddress: string,
): Promise<CirclesTransferEvent[]> {
  const normalized = normalizeAddress(recipientAddress);
  if (!normalized) return [];

  const payload = await gnosisRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "eth_getLogs",
    params: [
      {
        fromBlock: DEFAULT_START_BLOCK,
        toBlock: "latest",
        address: CIRCLES_HUB_ADDRESS,
        topics: [TRANSFER_SINGLE_TOPIC, null, null, padAddress(normalized)],
      },
    ],
  });

  const logs: Array<Record<string, string | string[]>> = Array.isArray(payload?.result)
    ? payload.result
    : [];
  return logs
    .map((log: Record<string, string | string[]>) => {
      const topics = Array.isArray(log.topics) ? log.topics : [];
      if (topics.length < 4) return null;
      const operator = `0x${String(topics[1]).slice(26)}`;
      const from = `0x${String(topics[2]).slice(26)}`;
      const to = `0x${String(topics[3]).slice(26)}`;
      const dataHex = String(log.data || "0x");
      const valueHex = dataHex.length >= 130 ? `0x${dataHex.slice(66, 130)}` : "0x0";
      return {
        transactionHash: String(log.transactionHash || ""),
        from: from.toLowerCase(),
        to: to.toLowerCase(),
        operator: operator.toLowerCase(),
        value: BigInt(valueHex).toString(),
        blockNumber: String(log.blockNumber || ""),
        timestamp: "",
        transactionIndex: String(log.transactionIndex || ""),
        logIndex: String(log.logIndex || ""),
        sender: operator.toLowerCase(),
      } satisfies CirclesTransferEvent;
    })
    .filter((event): event is CirclesTransferEvent => Boolean(event));
}

function parseAuthData(raw: string): { purpose: string; nonce: string } | null {
  let text = raw;
  if (raw.startsWith("0x")) {
    const hex = raw.slice(2);
    if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
      try {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
          bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
        }
        text = new TextDecoder().decode(bytes).replace(/\0/g, "").trim();
      } catch {
        return null;
      }
    }
  }

  const match = text.match(/trust_cleaner_auth:([a-f0-9]{32})/i);
  return match ? { purpose: "trust_cleaner_auth", nonce: match[1].toLowerCase() } : null;
}

async function fetchTransferDataAuthData(
  recipientAddress: string,
  txHashes: Set<string>,
) {
  const results = new Map<string, { purpose: string; nonce: string }>();

  try {
    const response = await fetch(circlesConfig.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "circles_events",
        params: [recipientAddress, null, null, ["CrcV2_TransferData"]],
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });

    if (!response.ok) return results;
    const payload = await response.json();
    const events = Array.isArray(payload?.result?.events) ? payload.result.events : [];

    for (const item of events) {
      const values = item?.values ?? {};
      const txHash = String(values.transactionHash ?? "").toLowerCase();
      if (!txHash || !txHashes.has(txHash)) continue;
      const authData = parseAuthData(String(values.data ?? ""));
      if (authData) results.set(txHash, authData);
    }
  } catch {
    return results;
  }

  return results;
}

async function fetchTxInputAuthData(txHashes: string[]) {
  const results = new Map<string, { purpose: string; nonce: string }>();
  if (txHashes.length === 0) return results;

  const batchSize = 20;
  for (let i = 0; i < txHashes.length; i += batchSize) {
    const batch = txHashes.slice(i, i + batchSize);
    const payload = await gnosisRpc(
      batch.map((hash, index) => ({
        jsonrpc: "2.0",
        id: index + 1,
        method: "eth_getTransactionByHash",
        params: [hash],
      })),
    );

    const responses = Array.isArray(payload) ? payload : [];
    for (let j = 0; j < responses.length; j += 1) {
      const input = responses[j]?.result?.input;
      if (!input || typeof input !== "string") continue;
      const authData = parseAuthData(input);
      if (authData) results.set(batch[j].toLowerCase(), authData);
    }
  }

  return results;
}

function deduplicateEvents(
  streamEvents: CirclesTransferEvent[],
  transferEvents: CirclesTransferEvent[],
  exactWei: bigint,
  recipientAddress: string,
) {
  const seenTxHashes = new Set<string>();
  const results: CirclesTransferEvent[] = [];
  const normalizedRecipient = normalizeAddress(recipientAddress);

  for (const event of streamEvents) {
    try {
      if (BigInt(event.value) !== exactWei) continue;
    } catch {
      continue;
    }
    const txKey = event.transactionHash.toLowerCase();
    if (seenTxHashes.has(txKey)) continue;
    seenTxHashes.add(txKey);
    results.push(event);
  }

  const totals = new Map<string, { total: bigint; event: CirclesTransferEvent }>();
  for (const event of transferEvents) {
    if (normalizeAddress(event.to) !== normalizedRecipient) continue;
    const txKey = event.transactionHash.toLowerCase();
    const value = BigInt(event.value);
    const existing = totals.get(txKey);
    if (existing) existing.total += value;
    else totals.set(txKey, { total: value, event });
  }

  for (const [txKey, { total, event }] of totals) {
    if (seenTxHashes.has(txKey) || total !== exactWei) continue;
    seenTxHashes.add(txKey);
    results.push({ ...event, value: total.toString() });
  }

  return results;
}

export async function checkAllNewPayments(
  exactAmountCrc: number,
  recipientAddress: string,
): Promise<CirclesTransferEvent[]> {
  const normalized = normalizeAddress(recipientAddress);
  if (!normalized || exactAmountCrc <= 0) return [];

  const [streamEvents, transferEvents] = await Promise.all([
    fetchStreamCompletedFromChain(normalized),
    fetchTransferSingleFromChain(normalized),
  ]);

  const events = deduplicateEvents(
    streamEvents,
    transferEvents,
    crcAmountToWei(exactAmountCrc),
    normalized,
  );

  const txHashes = [...new Set(events.map((event) => event.transactionHash).filter(Boolean))];
  if (txHashes.length > 0) {
    const txHashSet = new Set(txHashes.map((hash) => hash.toLowerCase()));
    const transferData = await fetchTransferDataAuthData(normalized, txHashSet);
    const inputData = await fetchTxInputAuthData(txHashes);

    for (const event of events) {
      const key = event.transactionHash.toLowerCase();
      event.authData = transferData.get(key) || inputData.get(key) || null;
    }
  }

  return events;
}
