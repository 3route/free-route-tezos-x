# scripts/

Dev/demo scripts for **Tezos X previewnet**. Each loads `.env` (copy from [`../.env.example`](../.env.example)) and runs via `npm run <name>`. Per-run knobs go before the command (`PAY_SYMBOL=USDT npm run setup`) and override `.env`. Errors surface raw (no try/catch) — the real cause is in the Tezos error's `.errors`.

## First-time setup (in order)

Each step prints a value to paste into `.env` for the next one.

1. **Endpoints + keys → `.env`:** `MICHELSON_RPC`, `EVM_RPC`, `FREE_ROUTE_API`, `TZKT_EXPLORER`, and two throwaway previewnet keys `BUYER_MICHELSON_SK`, `SELLER_MICHELSON_SK`.
2. `npm run addresses` → prints buyer/seller `tz1…` + balances. **Fund both via the faucet** (XTZ to the `tz1…`): https://faucet.previewnet.tezosx.nomadic-labs.com
3. `npm run compile:fa2 && npm run deploy:fa2` → deploy the demo NFT contract. Save the printed KT1 as **`TEST_FA2`**.
4. `npm run deploy:objkt` → deploy the objkt marketplace. Save the printed KT1 as **`OBJKT_MARKETPLACE`**.
5. `npm run setup` → mint + list an NFT and fund the buyer's alias. Prints the ready `ASK_ID=… npm run example-buy` line.
6. Run that line → buy the NFT paying an ERC20.

After the first run, repeat only **setup → example-buy** for each new buy.

## Commands

| Command | Does | Required env | Optional |
|---|---|---|---|
| `addresses` | print buyer/seller address + XTZ balance (faucet targets) | `MICHELSON_RPC`, both `*_SK` | — |
| `compile:fa2` | LIGO-compile `contracts/fa2_nft.mligo` → `…json` | — (needs `ligo` on PATH) | — |
| `deploy:fa2` | originate the demo FA2 NFT → prints `TEST_FA2` | `MICHELSON_RPC`, `BUYER_MICHELSON_SK` | — |
| `deploy:objkt` | originate the objkt v4 system → prints `OBJKT_MARKETPLACE` | `MICHELSON_RPC`, `BUYER_MICHELSON_SK` | — |
| `setup` | mint + list an ask + fund the alias → prints `ASK_ID` | `MICHELSON_RPC`, `EVM_RPC`, `FREE_ROUTE_API`, `TZKT_EXPLORER`, both `*_SK`, `TEST_FA2`, `OBJKT_MARKETPLACE` | `PAY_SYMBOL` (USDC), `PRICE_XTZ` (0.004) |
| `example-buy` | pay an ERC20 → buy the XTZ-priced ask (price read on-chain) | `MICHELSON_RPC`, `EVM_RPC`, `FREE_ROUTE_API`, `TZKT_EXPLORER`, `BUYER_MICHELSON_SK`, `OBJKT_MARKETPLACE`, `ASK_ID` | `PAY_SYMBOL` (USDC), `FREE_ROUTE_API_KEY` |

Notes:
- The FA2/objkt deployer is `BUYER_MICHELSON_SK` (the deployer holds no special role); `setup`/`example-buy` sign mint/list as the seller and buy as the buyer.
- `FREE_ROUTE_API_KEY` is only for a hosted free-route server; the local dev server is keyless.
- `env.ts` and `send.ts` are internal helpers, not run directly.
