# scripts/

Dev/demo scripts for **Tezos X previewnet**. Each loads `.env` (copy from [`../.env.example`](../.env.example)) and runs via `npm run <name>`. Per-run knobs go before the command (`PAY_SYMBOL=USDT npm run setup`) and override `.env`. Errors surface raw (no try/catch).

Grouped by side, mirroring `src/`:
- **`shared/`** — `env.ts` (config), `client.ts` (free-route client + token/ask-price helpers), `setup.ts`, `deploy-*.ts` (one-time on-chain fixtures, built with Taquito).
- **`michelson/`** — Temple-style flow: `addresses.ts`, `send.ts` (Taquito sender), `example-buy.ts`.
- **`evm/`** — MetaMask-style flow: `addresses.ts`, `send.ts` (viem sender), `fund.ts` (token top-up helper, used by `setup`), `bridge.ts`, `example-buy.ts`.

Both buy flows purchase the **same listed ask** (created by `setup`); they differ only in which wallet signs.

## First-time setup (in order)

Each step prints a value to paste into `.env` for the next one.

1. **Endpoints + keys → `.env`:** `MICHELSON_RPC`, `EVM_RPC`, `FREE_ROUTE_API`, `FREE_ROUTE_API_KEY`, `TZKT_EXPLORER` (Tezos ops), `EVM_EXPLORER` (EVM txs), and two throwaway previewnet keys `BUYER_MICHELSON_SK`, `SELLER_MICHELSON_SK`.
2. `npm run addresses:michelson` → prints buyer/seller `tz1…` + balances. **Fund both via the faucet** (XTZ to the `tz1…`): https://faucet.previewnet.tezosx.nomadic-labs.com
3. `npm run compile:fa2 && npm run deploy:fa2` → deploy the demo NFT. Save the printed KT1 as **`TEST_FA2`**.
4. `npm run deploy:objkt` → deploy the objkt marketplace. Save the printed KT1 as **`OBJKT_MARKETPLACE`**.
5. `npm run setup` → mint + list an NFT and fund the buyer's pay-token (the Michelson alias, and — if `EVM_SK` is set — the EVM account too). Prints the ready `ASK_ID=…` lines for **both** buy flows.
6. Buy from either side (below).

After the first run, repeat only **setup → a buy** for each new ask.

### Michelson (Temple) buy
`ASK_ID=… PAY_SYMBOL=USDC npm run example-buy:michelson` — signs one Tezos op-group with `BUYER_MICHELSON_SK`.

### EVM (MetaMask) buy
1. Put an EVM key in `.env` as **`EVM_SK`**, funded with gas XTZ on its `0x…` (faucet) — `npm run addresses:evm` prints the address + balance + alias.
2. With `EVM_SK` set, `npm run setup` also auto-funds the EVM account's `PAY_SYMBOL` (EVM-signed swap, the account pays its own XTZ). Then: `ASK_ID=… PAY_SYMBOL=USDC npm run example-buy:evm`.

`bridge:evm` is a standalone Bridge demo (swap XTZ → token on the EVM account) — not required for the buy.

## Commands

| Command | Does | Required env | Optional |
|---|---|---|---|
| `addresses:michelson` | print buyer/seller `tz1…` + XTZ balance + EVM alias (faucet targets) | `MICHELSON_RPC`, both `*_SK` | — |
| `addresses:evm` | print the EVM account `0x…` + XTZ gas balance + Michelson alias | `EVM_RPC`, `EVM_SK` | — |
| `compile:fa2` | LIGO-compile `contracts/fa2_nft.mligo` → `…json` | — (needs `ligo` on PATH) | — |
| `deploy:fa2` | originate the demo FA2 NFT → prints `TEST_FA2` | `MICHELSON_RPC`, `BUYER_MICHELSON_SK` | — |
| `deploy:objkt` | originate the objkt v4 system → prints `OBJKT_MARKETPLACE` | `MICHELSON_RPC`, `BUYER_MICHELSON_SK` | — |
| `setup` | mint + list an ask + fund the alias (and the EVM account if `EVM_SK` set) → prints `ASK_ID` | `MICHELSON_RPC`, `EVM_RPC`, `FREE_ROUTE_API`, `FREE_ROUTE_API_KEY`, `TZKT_EXPLORER`, both `*_SK`, `TEST_FA2`, `OBJKT_MARKETPLACE` | `PAY_SYMBOL` (USDC), `PRICE_XTZ` (0.004); `EVM_SK` + `EVM_EXPLORER` to also fund the EVM account |
| `example-buy:michelson` | **Michelson:** pay an ERC20 → buy the ask (one signed op-group) | `MICHELSON_RPC`, `EVM_RPC`, `FREE_ROUTE_API`, `FREE_ROUTE_API_KEY`, `TZKT_EXPLORER`, `BUYER_MICHELSON_SK`, `OBJKT_MARKETPLACE`, `ASK_ID` | `PAY_SYMBOL` (USDC) |
| `bridge:evm` | **EVM:** swap native XTZ → `PAY_SYMBOL` on the EVM account | `EVM_RPC`, `EVM_EXPLORER`, `FREE_ROUTE_API`, `FREE_ROUTE_API_KEY`, `EVM_SK` | `PAY_SYMBOL` (USDC), `IN_XTZ` (0.05) |
| `example-buy:evm` | **EVM:** pay an ERC20 → buy the ask (approve+swap+fulfill) | `MICHELSON_RPC`, `EVM_RPC`, `EVM_EXPLORER`, `FREE_ROUTE_API`, `FREE_ROUTE_API_KEY`, `EVM_SK`, `OBJKT_MARKETPLACE`, `ASK_ID` | `PAY_SYMBOL` (USDC) |

Notes:
- The FA2/objkt deployer is `BUYER_MICHELSON_SK` (holds no special role); `setup` signs mint/list as the seller.
- `FREE_ROUTE_API_KEY` is the free-route API key (required).
- **Atomicity:** the SDK's `evm.*` builders return a ready `EvmTxRequest[]` — a dApp sends it in one `wallet_sendCalls` (EIP-5792) for an atomic batch. These headless scripts have no wallet, so `evm/send.ts` sends the txs **sequentially** (functional check); it is not atomic.
- Internal helpers (`env.ts`, `client.ts`, `send.ts`, `evm/fund.ts`) are not run directly.
