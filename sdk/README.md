# Tezos-driven swap+bridge SDK

Universal, minimal SDK that builds **Tezos op-group operations** to **swap any EVM ERC20 → native XTZ** (via a
3route router, driven from Tezos through the `call_evm` gateway) and **bridge that XTZ to a `tz1`**. It produces
`[reset?, approve?, swapAndBridgePull]` — the consumer appends its own operation(s) (e.g. an objkt `fulfill_ask`)
and batches everything into one atomic, single-signature op-group.

Marketplace-agnostic and signer-agnostic: the SDK only **builds** ops (returns `TransferParams` /
`ParamsWithKind[]`); you sign them with Beacon (browser) or InMemorySigner (node). No env, no I/O except the
optional allowance read in `buildSwapBridgeBatch` (via an injected `ethers.Provider`).

Validated end-to-end on Tezos X previewnet (see [../DESIGN.md](../DESIGN.md)). A full objkt-buy demo lives in
[../example/](../example/). TypeScript, ESM (NodeNext), strict.

## Build / check / run
```bash
npm install            # ethers + @taquito + typescript + tsx
npm run check          # tsc --noEmit (sdk + example)
npm run build          # tsc -> dist/ (.js + .d.ts) — the publishable SDK (sdk/ only)
npm run example        # tsx example/example.ts — print the batch (needs RS_API)
RS_API=http://127.0.0.1:3000 SEND=1 npm run example   # run it live on previewnet
```

## API
| function | what |
|---|---|
| `quoteExactOut({client, priceMutez, tokenIn, slippage?})` | exact-out quote from rust-3route → `Quote` (real router calldata) |
| `getTokens(client)` / `getSwap(client, params)` | typed rust-3route client (`/tokens`, `/swap`) |
| `tokenList` / `findToken` / `assertSupported` | token registry helpers (availability check) |
| `swapResponseToQuote(resp, {tokenIn, minXtzOut})` | parse a `/swap` response into a `Quote` |
| `buildApproveOperation({token, amountIn})` | scoped ERC20 approve op (`call_evm` token.approve(SwapBridge)) |
| `buildSwapOperation(quote, {recipientTz1})` | the swap+bridge op (`call_evm` → `SwapBridge.swapAndBridgePull`) |
| `wrapWithApprove(ops, {token, amountIn, resetFirst?})` | pure: prepend a scoped approve (+ optional USDT-style reset) |
| `buildSwapBridgeBatch({provider, buyerTz1, quote})` | **high-level**: allowance check → `[reset?, approve?, swap]` (untagged) |
| `buildBatchTransaction(operations)` | tag → `ParamsWithKind[]`; guards Σ gasLimit ≤ 3M (per-block cap) |
| translation | `tzToAlias`, `mutezToWei`/`weiToMutez`, `encodeApproveArgs`, `encodeSwapAndBridgePullArgs`, `SIG_*` |

## Usage
```ts
import {
  getTokens, assertSupported, quoteExactOut, buildSwapBridgeBatch, buildBatchTransaction,
} from 'objkt-usdc-sdk';
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider(EVM_RPC);
const client = { baseUrl: RS_API, chainId: 128064 };                  // live rust-3route server

const registry = await getTokens(client);
assertSupported(registry, payToken);                                  // availability check
const quote = await quoteExactOut({ client, priceMutez: 50000, tokenIn: payToken });  // exact-out → real router

// SDK builds [reset?, approve?, swapAndBridgePull]; you append your own op(s) and batch them.
const sb = await buildSwapBridgeBatch({ provider, buyerTz1, quote });
const ops = buildBatchTransaction([...sb.ops, myOwnOperation]);       // e.g. objkt fulfill_ask

await tezos.contract.batch(ops).send();   // one Beacon signature; atomic
```
The pay token is **any ERC20** the server can route to native XTZ — pass it as `tokenIn`. The appended op is
**anything** — the SDK never knows about it (the [example](../example/) appends objkt `fulfill_ask`).

## Notes
- **quote**: `{ tokenIn, amountIn(pay-token units), minXtzOut(wei), router, swapCalldata }` — rust-3route exact-out, real router.
- **approve**: scoped, **in-batch** (preserves "sign once"); auto-revoked on-contract after the swap (no standing allowance). Added only when allowance is short; if a **non-zero** allowance is in the way, an `approve(0)` reset is prepended first (USDT-style guard — auto, override via `buildSwapBridgeBatch({resetAllowance})`).
- **gas/fee**: `call_evm` ops pin `gasLimit`/`fee`/`storageLimit` from `DEFAULTS` — on previewnet Taquito auto-estimation undershoots the fee floor and a `call_evm` needs an explicit gasLimit to back the EVM execution. Σ gasLimit ≤ 3M is enforced. Override per-op via builder params.
- **addresses**: minimal previewnet config (gateway / swapBridge / maxOpGas) in [config.ts](config.ts) — override `cfg` for mainnet/reset.
- **structure**: `types.ts` · `config.ts` · `translation.ts` · `threeroute.ts` · `quote.ts` · `builder.ts` · `swap.ts` · `index.ts`.
- **SwapBridge security model**: `router`/`swapCalldata` are **untrusted, not validated** — safety is the OUTPUT invariant (`>= minXtzOut` native bridged to the recipient, unused input refunded, else atomic revert), so a wrong `tokenOut`/redirect/hostile router can't steal. **Ownerless, no rescue**: anything sent outside the flow is unrecoverable by design; the normal flow strands nothing. The on-chain side is a self-contained Foundry project in [`../contracts`](../contracts) (`src/` + `test/` + deploy).
