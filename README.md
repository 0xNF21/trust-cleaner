# Trust Cleaner

Trust Cleaner is a Circles-native mini-app for auditing a wallet trust graph.

The first build is deliberately read-only: connect inside the Circles host, or open the app standalone and enter an address, then inspect outgoing trusts, incoming trusts, mutual trusts, and the raw first page returned by the Circles SDK.

## Modes

- Embedded mini-app: the Circles host injects the wallet through `@aboutcircles/miniapp-sdk`.
- Standalone: the page works in a normal browser by entering an address manually or opening `/?address=0x...`.
- Standalone auth: the user pays 1 CRC with `trust_cleaner_auth:<nonce>` data as an ownership proof, then the app triggers an automatic 1 CRC refund.
- Future write flow: manual untrust should support both host-signed transactions and standalone Gnosis App deep links/QRs, like CRC Boost.

## Current Phase

Phase 0 validates the trust graph read path only.

- `sdk.rpc.trust.getTrusts(address)`
- `sdk.rpc.trust.getTrustedBy(address)`
- `sdk.rpc.trust.getMutualTrusts(address)`
- `sdk.rpc.trust.getTrustRelations(address, 50, "DESC")`

No database, no untrust transaction, no batch flow yet.

Authentication does use Postgres so the standalone proof and refund can be durable.

## Auth Refund Config

Standalone auth requires:

```text
DATABASE_URL=
SAFE_ADDRESS=
AUTH_REFUND_TOKEN_ADDRESS=
BOT_PRIVATE_KEY=
ROLES_MODIFIER_ADDRESS=
ROLE_KEY=
```

`SAFE_ADDRESS` receives the 1 CRC proof payment. `AUTH_REFUND_TOKEN_ADDRESS` is the ERC-1155 Circles token ID the Safe sends back to the payer.

## Run

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Playground

Deploy to a public HTTPS URL, then open the Circles playground:

```text
https://circles.gnosis.io/playground?url=<your-deploy-url>
```

The host wallet should populate the address field automatically.
