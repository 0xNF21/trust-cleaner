import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { real } from "drizzle-orm/pg-core";

export const authChallenges = pgTable(
  "auth_challenges",
  {
    id: serial("id").primaryKey(),
    method: text("method").notNull(),
    nonce: text("nonce").notNull().unique(),
    message: text("message").notNull(),
    expectedAddress: text("expected_address"),
    txHash: text("tx_hash"),
    signature: text("signature"),
    refundTxHash: text("refund_tx_hash"),
    verifyTokenHash: text("verify_token_hash"),
    status: text("status").notNull().default("pending"),
    errorMessage: text("error_message"),
    origin: text("origin"),
    metadata: jsonb("metadata"),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => ({
    nonceIdx: index("auth_challenges_nonce_idx").on(table.nonce),
    statusIdx: index("auth_challenges_status_idx").on(table.status),
    expiresAtIdx: index("auth_challenges_expires_at_idx").on(table.expiresAt),
    txHashIdx: index("auth_challenges_tx_hash_idx").on(table.txHash),
  }),
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: serial("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    address: text("address").notNull(),
    origin: text("origin").notNull(),
    lastAuthChallengeId: integer("last_auth_challenge_id"),
    userAgentHash: text("user_agent_hash"),
    expiresAt: timestamp("expires_at").notNull(),
    hardExpiresAt: timestamp("hard_expires_at").notNull(),
    lastActiveAt: timestamp("last_active_at").defaultNow().notNull(),
    lastRefreshedAt: timestamp("last_refreshed_at").defaultNow().notNull(),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    tokenHashIdx: index("auth_sessions_token_hash_idx").on(table.tokenHash),
    addressIdx: index("auth_sessions_address_idx").on(table.address),
    expiresAtIdx: index("auth_sessions_expires_at_idx").on(table.expiresAt),
  }),
);

export const claimedPayments = pgTable(
  "claimed_payments",
  {
    id: serial("id").primaryKey(),
    txHash: text("tx_hash").notNull().unique(),
    purpose: text("purpose").notNull(),
    challengeId: integer("challenge_id").notNull(),
    payerAddress: text("payer_address").notNull(),
    amountCrc: integer("amount_crc").notNull(),
    claimedAt: timestamp("claimed_at").defaultNow().notNull(),
  },
  (table) => ({
    payerIdx: index("claimed_payments_payer_idx").on(table.payerAddress),
    purposeIdx: index("claimed_payments_purpose_idx").on(table.purpose),
  }),
);

export const payouts = pgTable(
  "payouts",
  {
    id: serial("id").primaryKey(),
    purpose: text("purpose").notNull(),
    payoutKey: text("payout_key").notNull().unique(),
    recipientAddress: text("recipient_address").notNull(),
    amountCrc: real("amount_crc").notNull(),
    reason: text("reason"),
    transferTxHash: text("transfer_tx_hash"),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    payoutKeyIdx: index("payouts_payout_key_idx").on(table.payoutKey),
    recipientIdx: index("payouts_recipient_idx").on(table.recipientAddress),
    statusIdx: index("payouts_status_idx").on(table.status),
  }),
);

export const botState = pgTable("bot_state", {
  id: integer("id").primaryKey().default(1),
  lastNonce: integer("last_nonce").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AuthChallengeRow = typeof authChallenges.$inferSelect;
export type AuthSessionRow = typeof authSessions.$inferSelect;
