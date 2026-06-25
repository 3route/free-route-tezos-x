# @baking-bad/free-route-tezos-x

[![npm](https://img.shields.io/npm/v/@baking-bad/free-route-tezos-x)](https://www.npmjs.com/package/@baking-bad/free-route-tezos-x) [![CI](https://github.com/3route/free-route-tezos-x/actions/workflows/ci.yml/badge.svg)](https://github.com/3route/free-route-tezos-x/actions/workflows/ci.yml)

Turn **free-route** swaps (any ERC20/XTZ pair) on **Tezos X** into ready-to-sign transactions — from the **Michelson side** (Taquito op-groups, e.g. Temple) or the **EVM side** (tx requests, e.g. MetaMask). Compose with marketplace ops (e.g. [objkt](https://objkt.com)) into one atomic action — for example, **pay any ERC20 for an XTZ-priced NFT**.

A small, dependency-light, **isomorphic** (browser + Node) ESM library. It only *prepares* operations — you sign and broadcast them with your own wallet ([Taquito](https://taquito.io) on the Michelson side, an EVM wallet on the EVM side).

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
const fulfill = objkt.buildFulfillAsk({
  marketplace: OBJKT_MARKETPLACE,
  askId: '1',
  editions: 1,
  amountMutez: priceMutez,
});

const ops = buildBatchTransaction(swapOps, fulfill);
const batch = await tezos.contract.batch().with(ops).send(); // a single signature
await batch.confirmation();
```

Just need a swap (no marketplace)? Stop after `freeRoute.michelson.buildSwapOperation` and send `swapOps`.

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
const swapTxs = freeRoute.evm.buildSwap({
  swap,
  srcAddress: payToken.address,
  approval,
});
const fulfill = objkt.buildEvmFulfillAsk({
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

The Quick start builds the client in one place for brevity. To keep a hosted free-route API key off the browser, split the read surface: run a keyed `FreeRouteClient` on your server behind thin proxy routes, and implement the `FreeRouteApi` interface on the client against those routes. `serialize*` / `parse*` carry quotes and swaps across the JSON boundary without losing their bigint fields (token reads are plain JSON — no `serialize` step).

**Server** — the API key lives here, never in the browser:

```ts
import { FreeRouteClient, tezosXMainnet, serializeQuote, serializeSwap } from '@baking-bad/free-route-tezos-x';
import type { QuoteQuery, SwapQuery } from '@baking-bad/free-route-tezos-x';

const freeRoute = new FreeRouteClient({
  baseUrl: FREE_ROUTE_API,
  chainId: tezosXMainnet.chainId,
  apiKey: FREE_ROUTE_API_KEY,
});

// behind your own routes (Next, Express, …); serialize* makes the model JSON-safe (bigint -> string)
export const routes = {
  tokens: () => freeRoute.getTokens(),
  quote: async (q: QuoteQuery) => serializeQuote(await freeRoute.getQuote(q)),
  swap: async (q: SwapQuery) => serializeSwap(await freeRoute.getSwap(q)),
};
```

**Client** — talks to your own endpoints (no key), parses DTOs back into typed models:

```ts
import { parseQuote, parseSwap } from '@baking-bad/free-route-tezos-x';
import type {
  FreeRouteApi, FreeRouteToken, QuoteQuery, QuoteResponseDto, SwapResponseDto,
} from '@baking-bad/free-route-tezos-x';

// your transport to the server routes above (`toParams` is your own query → querystring helper)
const get = <T>(path: string, query?: QuoteQuery): Promise<T> =>
  fetch(`/free-route/${path}` + (query ? `?${toParams(query)}` : '')).then((r) => r.json()) as Promise<T>;

// implement FreeRouteApi over your proxy — the rest of your app uses it like a direct client
export const freeRoute: FreeRouteApi = {
  getTokens: () => get<FreeRouteToken[]>('tokens'),
  getQuote: async (q) => parseQuote(await get<QuoteResponseDto>('quote', q)),
  getSwap: async (q) => parseSwap(await get<SwapResponseDto>('swap', q)),
};
```

The [demo dApp](https://github.com/3route/free-route-tezos-x-example) wires exactly this — Next.js route handlers plus a browser shim.

## API

| Export | What |
|---|---|
| `FreeRouteTezosX` / `…Michelson` / `…Evm` | facades: free-route reads + builders, pre-wired for the network. Root has `.michelson` + `.evm`; the side facades have one. |
| `FreeRouteClient` | low-level HTTP client — free-route reads only; prefer a facade, which also builds ops |
| `freeRoute.michelson.buildSwapOperation` / `buildErc20Approve` / `buildCallEvm` | Michelson ops (`ParamsWithKind`) — sign with Taquito |
| `freeRoute.evm.buildSwap` / `buildApprove` / `buildCallMichelson` | EVM tx requests (`EvmTxRequest`) — send with an EVM wallet |
| `objkt.buildFulfillAsk` / `objkt.buildEvmFulfillAsk` | objkt v4 `fulfill_ask` — Michelson op / EVM tx |
| `resolveApproval` / `readAllowance` | read an ERC20 allowance and pick the minimal safe `ApprovalMode` |
| `buildBatchTransaction` | flatten Michelson ops into one atomic group |
| `forgeMichelson` | forge a Micheline value for `callMichelson` data (EVM side) |
| `targetForMinOut` | gross up an exact-out target so the post-slippage floor covers a hard minimum |
| `michelsonToEvmAlias` / `evmToMichelsonAlias` / `aliasOf` | map an address to its alias on the other runtime (tz1 → 0x, 0x → KT1, or auto-detect) |
| `toEvmUnits` / `fromEvmUnits`, `XTZ`, `XTZ_ADDRESS` | XTZ mutez ⇄ wei + the native-XTZ token |
| `tezosXMainnet` / `tezosXPreviewnet`, `EVM_GATEWAY` / `MICHELSON_GATEWAY` | network presets (chainId + both gateways) and the fixed cross-runtime gateway addresses (same on every network) |

`michelson.*` builders return Taquito `ParamsWithKind`; `evm.*` builders return `EvmTxRequest` — you choose how to sign.

## Demo / scripts

The [`scripts/`](scripts) folder has an end-to-end demo on Tezos X previewnet (deploy an NFT + marketplace, list an ask, then buy it from **either** the Michelson or the EVM side). See [scripts/README.md](scripts/README.md).

## License

[MIT](LICENSE) © Baking Bad
