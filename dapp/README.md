# objkt EVM-pay — demo dApp

Next.js SPA on top of the pure-SDK (`../sdk`). Two modes (header toggle):

- **Seller** — mint N fresh NFTs into the test FA2 and list them as XTZ-priced asks on objkt, prefilled,
  in one click (auto-split into batches under the gas ceiling).
- **Buyer** — browse active listings, see your tz1 / EVM-alias balances, pick any ERC20 (USDC / uranium /
  gold …) to pay, review the intent, and buy — one atomic Tezos op-group `[approve, swap (call_evm), fulfill_ask]`.

Signing is client-side via **Temple/Beacon**. Read-only data comes from tzkt + the EVM RPC; 3route quotes are
proxied through `/api/v6.1/*` (server-side) to avoid browser CORS.

## Run

```bash
# 1. start the rust-3route server on :3000 (separate terminal, from ../rust-3route)
./target/release/three-route --base config/default.toml deploy/config.TezosXPreviewnetLocal.toml

# 2. start the dApp on :3001
cd dapp
npm install
npm run dev          # http://localhost:3001
```

Connect Temple configured for **Tezos X previewnet** (custom network, RPC
`https://michelson.previewnet.tezosx.nomadic-labs.com`).

## Config

All wiring has working previewnet defaults in `lib/config.ts`; override via `.env.local` (see
`.env.local.example`). `THREE_ROUTE_API` (server-side) points the proxy at the 3route server.

## Layout

- `lib/sdk.ts` — adapter re-exporting the pure-SDK; `ThreeRouteApi` aimed at the same-origin proxy.
- `lib/ops.ts` — mint+list and buy batch builders (the SDK usage), chunked wallet send.
- `lib/wallet.ts` — Beacon connection + a wallet-bound `TezosToolkit`.
- `lib/tzkt.ts` / `lib/hooks.ts` — read-only listings + balances.
- `components/*` — Header (mode toggle, balances), SellerPanel, BuyerPanel, BuyModal, LogPanel.
