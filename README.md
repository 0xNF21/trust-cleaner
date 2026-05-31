# Trust Cleaner

Trust Cleaner is a Circles mini-app that helps a user review and clean their trust graph before signing any untrust action.

The goal is simple: keep a high-quality Circles trust network by making outgoing trust easier to audit, easier to understand, and safer to update.

- Production app: https://trust-cleaner.vercel.app
- GitHub repo: https://github.com/0xNF21/trust-cleaner
- Circles Playground: [open Trust Cleaner in Playground](https://circles.gnosis.io/playground?url=https%3A%2F%2Ftrust-cleaner.vercel.app)

## What It Does

Trust Cleaner reads a Circles profile and separates relations into clear review buckets:

- **Untrust candidates**: outgoing-only trusts that may expose the user to CRC they no longer want to accept.
- **Mutual watchlist**: mutual relations with weak or unclear signals, kept out of the untrust transaction by default.
- **Incoming-only trust**: profiles that trust the user while the user does not trust them back, shown as context without outgoing risk.
- **Clean relations**: mutual or low-risk relations that do not need action.

The app never untrusts automatically. Every action requires explicit user review and wallet confirmation.

## Cleaner Flow

The main workflow is guided step by step:

1. **Analyze circle** - load a Circles profile and read its trust graph.
2. **Review profiles** - inspect risk signals, account type, profile identity, age, trust score, backer status, and network shape.
3. **Confirm untrusts** - choose which profiles should really be untrusted.
4. **Prepare wallet review** - build the exact transaction preview for the wallet.
5. **Sign in wallet** - sign the untrust calls inside the Circles mini-app host.
6. **Verify cleanup** - reread the circle and confirm that signed profiles disappeared from outgoing trust.

## Modes

### Circles Mini-App Mode

This is the full mode.

Open Trust Cleaner inside the Circles host or Circles Playground. The host injects the wallet through `@aboutcircles/miniapp-sdk`, and Trust Cleaner can send the reviewed untrust transactions to the connected wallet.

Use the Playground with the link above.

The deploy URL is passed as the `url` parameter so the Playground knows which mini-app to load.

### Standalone Web Mode

The standalone website works for analysis and review:

- search or paste a Circles address
- inspect the cleaner diagnosis
- review candidates and mutual watchlist
- prepare the wallet review draft
- use standalone authentication by proving ownership with a 1 CRC payment that is refunded
- view signed-action history saved locally in the browser

Standalone web mode does **not** currently sign untrust transactions. Signing requires the Circles mini-app host wallet.

## Signature Behavior

Confirmed untrust actions are encoded as Circles Hub calls:

```text
trust(target, 0)
```

The app prepares the transaction draft first, then asks the wallet to sign only after the user reviews the selected profiles. If the plan changes after preparation, the user must prepare the wallet review again before signing.

## Data Sources

Trust Cleaner uses:

- `@aboutcircles/sdk` for trust graph reads and Circles Hub transaction encoding
- `@aboutcircles/miniapp-sdk` for mini-app wallet actions
- Circles profile data for names, images, and account type labels
- trust score enrichment for review priority and context
- local browser storage for signed-action history
- Postgres for standalone authentication challenges, sessions, and refund tracking

## Environment Variables

Copy `.env.example` and fill the required values:

```text
NEXT_PUBLIC_APP_URL=
DATABASE_URL=
NEXT_PUBLIC_CIRCLES_RPC_URL=
GARAGE_TRUST_SCORE_API_URL=
TRUST_CLEANER_SCORE_CACHE_SECONDS=
SAFE_ADDRESS=
AUTH_REFUND_TOKEN_ADDRESS=
BOT_PRIVATE_KEY=
ROLES_MODIFIER_ADDRESS=
ROLE_KEY=
```

Standalone authentication requires the database and refund configuration. Pure read-only local testing can run with the public app URL and Circles RPC settings.

## Local Development

Install dependencies:

```bash
pnpm install
```

Run the development server:

```bash
pnpm dev
```

Open:

```text
http://localhost:3000
```

Useful checks:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

## Submission Notes

Trust Cleaner is designed as a manual safety layer for Circles users. It does not decide for the user; it organizes the trust graph, highlights suspicious or unclear relations, prepares transparent wallet calls, and verifies the result after signature.

The current submission is focused on the cleaner workflow. The graph visualization and deeper circulation-path UI can become a later V2.
