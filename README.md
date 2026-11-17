# @baking-bad/free-route-tezos-x

[![npm](https://img.shields.io/npm/v/@baking-bad/free-route-tezos-x)](https://www.npmjs.com/package/@baking-bad/free-route-tezos-x) [![CI](https://github.com/3route/free-route-tezos-x/actions/workflows/ci.yml/badge.svg)](https://github.com/3route/free-route-tezos-x/actions/workflows/ci.yml)

Turn **free-route** swaps (any ERC20/XTZ pair) on **Tezos X** into ready-to-sign transactions — from the **Michelson side** (Taquito op-groups, e.g. Temple) or the **EVM side** (tx requests, e.g. MetaMask). Compose with marketplace ops (e.g. [objkt](https://objkt.com)) into one atomic action — for example, **pay any ERC20 for an XTZ-priced NFT**.

A small, dependency-light, **isomorphic** (browser + Node) ESM library. It only *prepares* operations — you sign and broadcast them with your own wallet ([Taquito](https://taquito.io) on the Michelson side, an EVM wallet on the EVM side).

> **Live demo dApp:** [**3route/free-route-tezos-x-example**](https://github.com/3route/free-route-tezos-x-example) (Next.js) — buy / bridge / mint-list from both wallet sides (Temple + MetaMask), showing the server/client API-key split. The canonical example of consuming this SDK.

## How it works

Tezos X is one chain with two interfaces — Michelson (Tezlink) and EVM (Etherlink) — that can call each other atomically within a single transaction. This library prepares the calls for whichever side signs:

- **Michelson-native** (your tz1 signs): the op-group calls the EVM-side free-route router via `call_evm`, acting as your account's **EVM alias** (a `0x` derived from your tz1). The ERC20→XTZ swap's native-XTZ output lands on that alias, which **auto-forwards** it to your tz1 (the alias is an `AliasForwarder` that returns any tez to its native account). Your tz1 then funds a Michelson op (e.g. a marketplace purchase) — all in one atomic, single-signature group.
- **EVM-native** (your 0x signs): the free-route `/swap` response is already a raw EVM transaction, so you send it directly; to reach a Michelson contract you call `callMichelson` on the EVM→Michelson gateway, acting as your account's **Michelson alias** (a `KT1` derived from your 0x) — so the NFT lands on that alias. A wallet batches `approve + swap + fulfill` atomically via [EIP-5792](https://eips.ethereum.org/EIPS/eip-5792) `wallet_sendCalls`.

## Install

```sh
npm i @baking-bad/free-route-tezos-x
```

Requires **Node ≥ 20** or a modern browser (uses global `fetch`; on older runtimes pass your own via the `fetch` option).

Peer dependencies (install only the side(s) you use — see [Entrypoints](#entrypoints)):

- both sides: `@taquito/michelson-encoder`, `@taquito/utils`
- Michelson side: `@taquito/taquito` *(optional peer)*
- EVM side: `@taquito/michel-codec` *(optional peer)*

## Quick start — Michelson (Temple)

Buy an XTZ-priced objkt NFT paying USDC, in one atomic op-group:

```ts
import { TezosToolkit } from '@taquito/taquito';
import {
  FreeRouteTezosX, tezosXMainnet, XTZ, toEvmUnits, targetForMinOut,
  michelsonToEvmAlias, resolveApproval, buildBatchTransaction, objkt,
} from '@baking-bad/free-route-tezos-x';

const tezos = new TezosToolkit(MICHELSON_RPC); // bring your own signer / wallet
const freeRoute = new FreeRouteTezosX({
  baseUrl: FREE_ROUTE_API,
  network: tezosXMainnet,
  apiKey: FREE_ROUTE_API_KEY, // free-route API key
});

const buyerAddress = await tezos.signer.publicKeyHash(); // your Michelson address
const buyerAlias = michelsonToEvmAlias(buyerAddress);  // its EVM-side identity (holds the ERC20)
const payToken = (await freeRoute.getTokens()).find((token) => token.symbol === 'USDC')!;

const priceMutez = 4_000n;  // the ask price (read it from the marketplace)
const slippageBps = 200;    // 2%

// exact-out swap, sized so the on-chain floor (target − slippage) still covers the price
const minOutTarget = targetForMinOut(priceMutez, slippageBps);
const swapAmount = toEvmUnits(minOutTarget, XTZ.address); // mutez -> wei for the EVM API

const swap = await freeRoute.getSwap({
  src: payToken.address,
  dst: XTZ.address,
  amount: swapAmount,
  isExactOut: true,
  from: buyerAlias,
  receiver: buyerAlias,
  slippageBps,
});

// read the on-chain allowance -> pick the minimal safe approval mode (none / approve / reset+approve)
const approval = await resolveApproval({
  evmRpc: EVM_RPC,
  token: payToken.address,
  owner: buyerAlias,
  spender: swap.tx.to,
  amount: swap.srcAmount,
});

// approve(s) + swap, composed with the marketplace fulfill -> one atomic group
const swapOps = freeRoute.michelson.buildSwapOperation({
  swap,
  srcAddress: payToken.address,
  approval,
});
const fulfill = objkt.buildMichelsonFulfillAskOperation({
  marketplace: OBJKT_MARKETPLACE,
  askId: '1',
  editions: 1,
  amountMutez: priceMutez,
});

const ops = buildBatchTransaction(swapOps, fulfill);
// size the group on the node (also checks it end-to-end before signing) — see "Gas on the Michelson side"
const readyOps = await freeRoute.michelson.estimateOperation({ tezos, ops });
const batch = await tezos.contract.batch().with(readyOps).send(); // a single signature
await batch.confirmation();
```

Just need a swap (no marketplace)? Stop after `freeRoute.michelson.buildSwapOperation` and send `swapOps`.

### Gas on the Michelson side

The gas a Michelson op *declares* becomes the EVM budget of its nested `call_evm` call, and the node's own
estimate of such an op runs short of what must be declared (up to ~1.4×), so a bare wallet/Taquito estimate fails
with `tezlink_error`. The SDK handles it two ways:

- **Offline pins (default).** Every `call_evm` op from the builders carries `gasLimit` / `storageLimit` / `fee`
  sized from the aggregator's EVM gas estimate, capped under the per-op gas limit. No RPC; a generous margin
  (you pay some extra fee).
- **`estimateOperation` (preferred at send time).** Simulates the whole group once, sizes the `call_evm` ops at
  the node's estimate × 2 (fee priced at the node's rates) and leaves pure-Michelson ops at the node's estimate.
  Cheaper, tracks protocol changes, and fails *before* signing if the group would revert (e.g. the ask is gone).
  Call it once, right before signing; pass any signer- or wallet-backed `TezosToolkit`.

The EVM side needs neither: `EvmTxRequest` carries no gas and the wallet's estimate is accurate.

## Quick start — EVM (MetaMask)

The same buy from a native EVM account. The builders return `EvmTxRequest[]` — a ready batch for one atomic `wallet_sendCalls`:

```ts
import {
  FreeRouteTezosXEvm, tezosXMainnet, XTZ, toEvmUnits, targetForMinOut,
  evmToMichelsonAlias, resolveApproval, objkt,
} from '@baking-bad/free-route-tezos-x/evm';

const freeRoute = new FreeRouteTezosXEvm({
  baseUrl: FREE_ROUTE_API,
  network: tezosXMainnet,
  apiKey: FREE_ROUTE_API_KEY, // free-route API key
});

const buyerAccount = '0x…';                           // the MetaMask account (holds the ERC20, pays gas)
const buyerAlias = evmToMichelsonAlias(buyerAccount); // the KT1 where the NFT lands
const payToken = (await freeRoute.getTokens()).find((token) => token.symbol === 'USDC')!;

const priceMutez = 4_000n;  // the ask price (read it from the marketplace)
const slippageBps = 200;    // 2%

// exact-out swap, sized so the on-chain floor (target − slippage) still covers the price
const minOutTarget = targetForMinOut(priceMutez, slippageBps);
const swapAmount = toEvmUnits(minOutTarget, XTZ.address); // mutez -> wei for the EVM API

const swap = await freeRoute.getSwap({
  src: payToken.address,
  dst: XTZ.address,
  amount: swapAmount,
  isExactOut: true,
  from: buyerAccount,
  receiver: buyerAccount,
  slippageBps,
});

// read the on-chain allowance -> pick the minimal safe approval mode (none / approve / reset+approve)
const approval = await resolveApproval({
  evmRpc: EVM_RPC,
  token: payToken.address,
  owner: buyerAccount,
  spender: swap.tx.to,
  amount: swap.srcAmount,
});

// approve(s) + swap, composed with the marketplace fulfill (via callMichelson) -> one EvmTxRequest[] batch
const swapTxs = freeRoute.evm.buildSwapTransaction({
  swap,
  srcAddress: payToken.address,
  approval,
});
const fulfill = objkt.buildEvmFulfillAskTransaction({
  marketplace: OBJKT_MARKETPLACE,
  askId: '1',
  editions: 1,
  amountMutez: priceMutez,
});

await walletClient.sendCalls({ calls: [...swapTxs, fulfill] }); // EIP-5792 (MetaMask); the NFT lands on `buyerAlias`
```

`EvmTxRequest` carries no gas/fees — the wallet estimates them. A wallet without EIP-5792 can send the array sequentially (not atomic).

## Entrypoints

One package, three entrypoints — import the side you sign with so you only pull its peer deps:

| Import | Facade | Builders | Pulls (beyond core) |
|---|---|---|---|
| `@baking-bad/free-route-tezos-x` | `FreeRouteTezosX` — `.michelson.*` + `.evm.*` | both | `@taquito/taquito` + `@taquito/michel-codec` |
| `…/michelson` | `FreeRouteTezosXMichelson` — `.michelson.*` | Taquito op-groups | `@taquito/taquito` |
| `…/evm` | `FreeRouteTezosXEvm` — `.evm.*` | EVM tx requests | `@taquito/michel-codec` |

All facades share the free-route reads (`getTokens` / `getQuote` / `getSwap`) and both gateway addresses. `@taquito/taquito` and `@taquito/michel-codec` are **optional peers**; `@taquito/michelson-encoder` and `@taquito/utils` are required by every entrypoint.

## Keep your API key server-side

The Quick start builds the client in one place for brevity. To keep a hosted free-route API key off the browser, split the read surface: run a keyed `FreeRouteClient` on your server behind thin proxy routes, and implement the `FreeRouteApi` interface on the client against those routes. `serialize*` / `parse*` carry quotes and swaps across the JSON boundary without losing their bigint fields, and `serialize*Query` / `parse*Query` do the same for the request params (`parse*Query` also validates untrusted input). Token reads are plain JSON — no codec step.

**Server** — the API key lives here, never in the browser:

```ts
import {
  FreeRouteClient, tezosXMainnet, parseQuoteQuery, parseSwapQuery, serializeQuote, serializeSwap,
} from '@baking-bad/free-route-tezos-x';

const freeRoute = new FreeRouteClient({
  baseUrl: FREE_ROUTE_API,
  chainId: tezosXMainnet.chainId,
  apiKey: FREE_ROUTE_API_KEY,
});

// behind your own routes (Next, Express, …); parse* validates the untrusted query, serialize* makes the model JSON-safe (bigint -> string)
export const routes = {
  tokens: () => freeRoute.getTokens(),
  quote: async (params: URLSearchParams) => serializeQuote(await freeRoute.getQuote(parseQuoteQuery(params))),
  swap: async (params: URLSearchParams) => serializeSwap(await freeRoute.getSwap(parseSwapQuery(params))),
};
```

**Client** — talks to your own endpoints (no key), parses DTOs back into typed models:

```ts
import { parseQuote, parseSwap, serializeQuoteQuery, serializeSwapQuery } from '@baking-bad/free-route-tezos-x';
import type {
  FreeRouteApi, FreeRouteToken, QuoteResponseDto, SwapResponseDto,
} from '@baking-bad/free-route-tezos-x';

// your transport to the server routes above
const get = <T>(path: string, params?: URLSearchParams): Promise<T> =>
  fetch(`/free-route/${path}` + (params ? `?${params}` : '')).then((r) => r.json()) as Promise<T>;

// implement FreeRouteApi over your proxy — serialize the query, parse the response (both via the SDK codec)
export const freeRoute: FreeRouteApi = {
  getTokens: () => get<FreeRouteToken[]>('tokens'),
  getQuote: async (q) => parseQuote(await get<QuoteResponseDto>('quote', serializeQuoteQuery(q))),
  getSwap: async (q) => parseSwap(await get<SwapResponseDto>('swap', serializeSwapQuery(q))),
};

// ── elsewhere in your app (browser): build ops off the keyless `freeRoute` above + a network-keyed
//    builder — the builder needs only the gateway, so no API key leaves the server. ──
import { createMichelsonOpsBuilder, tezosXMainnet } from '@baking-bad/free-route-tezos-x';

const michelson = createMichelsonOpsBuilder(tezosXMainnet.michelsonGateway); // pure builder, runs anywhere

const swap = await freeRoute.getSwap({ src, dst, amount, isExactOut: true, from, receiver });
const swapOps = michelson.buildSwapOperation({ swap, srcAddress: src });
// size on the node with the wallet-backed toolkit (needs only the public RPC, no API key), then sign
const readyOps = await michelson.estimateOperation({ tezos, ops: swapOps });
// (or compose with a marketplace op first — see Quick start)
```

The [demo dApp](https://github.com/3route/free-route-tezos-x-example) wires exactly this — Next.js route handlers plus a browser shim.

## API

Three tiers for building ops — pick one and stay there:

1. **Facade** (monolith) — `FreeRouteTezosX` bundles the free-route reads and both builder sets, pre-wired to the network. This is the Quick start; use it when one place can hold the API key.
2. **Client + ops builder** (client/server split) — `FreeRouteClient` does the keyed reads on your server; `createMichelsonOpsBuilder(network.michelsonGateway)` / `createEvmOpsBuilder(network.evmGateway)` build ops anywhere, keyless. See [Keep your API key server-side](#keep-your-api-key-server-side).
3. **Standalone builders** (low-level) — `buildMichelsonSwapOperation` / `buildEvmSwapTransaction` / `buildCallMichelsonTransaction` … are the plain functions the two tiers above wrap; the factory/facade only pre-inject the gateway and drop the chain prefix (`buildEvmSwapTransaction` → `evm.buildSwapTransaction`). Reach for them to compose by hand or against a custom gateway.

| Export | Tier | What |
|---|---|---|
| `FreeRouteTezosX` / `…Michelson` / `…Evm` | facade | free-route reads + builders, pre-wired for the network. Root has `.michelson` + `.evm`; the side facades have one. |
| `FreeRouteClient` | split | keyed HTTP client — free-route reads only (`getTokens` / `getQuote` / `getSwap`) |
| `createMichelsonOpsBuilder` / `createEvmOpsBuilder` | split | gateway-bound builder set — keyless, pairs with `FreeRouteClient` |
| `buildMichelsonSwapOperation` / `buildMichelsonApproveOperation` / `buildCallEvmOperation` | low-level | Michelson ops (`ParamsWithKind`) — sign with Taquito |
| `buildEvmSwapTransaction` / `buildEvmApproveTransaction` / `buildCallMichelsonTransaction` | low-level | EVM tx requests (`EvmTxRequest`) — send with an EVM wallet; `buildCallMichelsonTransaction` takes the gateway explicitly |
| `objkt.buildMichelsonFulfillAskOperation` / `objkt.buildEvmFulfillAskTransaction` | helper | objkt v4 `fulfill_ask` — Michelson op / EVM tx |
| `resolveApproval` / `readAllowance` | helper | read an ERC20 allowance and pick the minimal safe `ApprovalMode` |
| `buildBatchTransaction` | helper | flatten Michelson ops into one atomic group |
| `estimateMichelsonOperation` | helper | simulate a Michelson op-group on the node and size its `call_evm` ops (estimate × `CALL_EVM_ESTIMATE_MARGIN`, capped) — facade: `michelson.estimateOperation`; see [Gas on the Michelson side](#gas-on-the-michelson-side) |
| `callEvmGas`, `CALL_EVM_GAS_CAP` / `CALL_EVM_ESTIMATE_MARGIN` / `CALL_EVM_STORAGE_LIMIT` | helper | the offline `call_evm` sizing policy the builders pin by default, and its constants |
| `forgeMichelson` | helper | forge a Micheline value for `callMichelson` data (EVM side) |
| `targetForMinOut` | helper | gross up an exact-out target so the post-slippage floor covers a hard minimum |
| `michelsonToEvmAlias` / `evmToMichelsonAlias` / `aliasOf` | helper | map an address to its alias on the other runtime (tz1 → 0x, 0x → KT1, or auto-detect). tz1/tz2/tz3 → 0x is the Etherlink 8.0 recoverable (CREATE2 rescue-account) alias; `legacyMichelsonToEvmAlias` gives the pre-8.0 one |
| `toEvmUnits` / `fromEvmUnits`, `XTZ`, `XTZ_ADDRESS` | helper | XTZ mutez ⇄ wei + the native-XTZ token |
| `tezosXMainnet` / `tezosXPreviewnet`, `EVM_GATEWAY` / `MICHELSON_GATEWAY` | const | network presets (chainId + both gateways) and the fixed cross-runtime gateway addresses (same on every network) |

Michelson builders return Taquito `ParamsWithKind` (an **operation**); EVM builders return `EvmTxRequest` (a **transaction**) — hence the `…Operation` / `…Transaction` suffix. The facade exposes the same builders namespaced, dropping the chain prefix (`freeRoute.michelson.buildSwapOperation`, `freeRoute.evm.buildSwapTransaction`), with the gateway already wired in.

## Demo / scripts

The [`scripts/`](scripts) folder has an end-to-end demo on Tezos X previewnet (deploy an NFT + marketplace, list an ask, then buy it from **either** the Michelson or the EVM side). See [scripts/README.md](scripts/README.md).

Those same flows are covered by automated integration tests against the live previewnet gateway — `npm run test:e2e` (buy / buy-with-recipient / bridge / bridge-with-receiver on both sides, asserting the on-chain outcome). They need a funded `.env`; the offline unit suite (`npm test`) stays mock-only.

## License

[MIT](LICENSE) © Baking Bad
