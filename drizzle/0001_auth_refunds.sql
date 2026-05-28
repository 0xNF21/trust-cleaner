CREATE TABLE IF NOT EXISTS "auth_challenges" (
  "id" serial PRIMARY KEY NOT NULL,
  "method" text NOT NULL,
  "nonce" text NOT NULL UNIQUE,
  "message" text NOT NULL,
  "expected_address" text,
  "tx_hash" text,
  "signature" text,
  "refund_tx_hash" text,
  "verify_token_hash" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "error_message" text,
  "origin" text,
  "metadata" jsonb,
  "used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL
);

CREATE TABLE IF NOT EXISTS "auth_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "address" text NOT NULL,
  "origin" text NOT NULL,
  "last_auth_challenge_id" integer,
  "user_agent_hash" text,
  "expires_at" timestamp NOT NULL,
  "hard_expires_at" timestamp NOT NULL,
  "last_active_at" timestamp DEFAULT now() NOT NULL,
  "last_refreshed_at" timestamp DEFAULT now() NOT NULL,
  "revoked_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "claimed_payments" (
  "id" serial PRIMARY KEY NOT NULL,
  "tx_hash" text NOT NULL UNIQUE,
  "purpose" text NOT NULL,
  "challenge_id" integer NOT NULL,
  "payer_address" text NOT NULL,
  "amount_crc" integer NOT NULL,
  "claimed_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "payouts" (
  "id" serial PRIMARY KEY NOT NULL,
  "purpose" text NOT NULL,
  "payout_key" text NOT NULL UNIQUE,
  "recipient_address" text NOT NULL,
  "amount_crc" real NOT NULL,
  "reason" text,
  "transfer_tx_hash" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "error_message" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "bot_state" (
  "id" integer DEFAULT 1 PRIMARY KEY NOT NULL,
  "last_nonce" integer NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "auth_challenges_nonce_idx" ON "auth_challenges" ("nonce");
CREATE INDEX IF NOT EXISTS "auth_challenges_status_idx" ON "auth_challenges" ("status");
CREATE INDEX IF NOT EXISTS "auth_challenges_expires_at_idx" ON "auth_challenges" ("expires_at");
CREATE INDEX IF NOT EXISTS "auth_challenges_tx_hash_idx" ON "auth_challenges" ("tx_hash");
CREATE INDEX IF NOT EXISTS "auth_sessions_token_hash_idx" ON "auth_sessions" ("token_hash");
CREATE INDEX IF NOT EXISTS "auth_sessions_address_idx" ON "auth_sessions" ("address");
CREATE INDEX IF NOT EXISTS "auth_sessions_expires_at_idx" ON "auth_sessions" ("expires_at");
CREATE INDEX IF NOT EXISTS "claimed_payments_payer_idx" ON "claimed_payments" ("payer_address");
CREATE INDEX IF NOT EXISTS "claimed_payments_purpose_idx" ON "claimed_payments" ("purpose");
CREATE INDEX IF NOT EXISTS "payouts_payout_key_idx" ON "payouts" ("payout_key");
CREATE INDEX IF NOT EXISTS "payouts_recipient_idx" ON "payouts" ("recipient_address");
CREATE INDEX IF NOT EXISTS "payouts_status_idx" ON "payouts" ("status");
