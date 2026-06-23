# @baking-bad/free-route-tezos-x

[![npm](https://img.shields.io/npm/v/@baking-bad/free-route-tezos-x)](https://www.npmjs.com/package/@baking-bad/free-route-tezos-x) [![CI](https://github.com/3route/free-route-tezos-x/actions/workflows/ci.yml/badge.svg)](https://github.com/3route/free-route-tezos-x/actions/workflows/ci.yml)

Turn **free-route** swaps (any ERC20/XTZ pair) on **Tezos X** into ready-to-sign Tezos operations, signed from the Michelson side. Native-XTZ output auto-forwards to your Michelson address. Compose with marketplace ops (e.g. [objkt](https://objkt.com)) into one atomic group — for example, **pay any ERC20 for an XTZ-priced NFT**.

A small, dependency-light, **isomorphic** (browser + Node) ESM library. It only prepares operations — you sign and broadcast them with your own [Taquito](https://taquito.io) toolkit.

## How it works

Tezos X exposes both a Michelson (Tezlink) and an EVM (Etherlink) interface, bridged by `call_evm`. This library builds Michelson ops that call the EVM-side free-route router: an ERC20→XTZ swap (with the right `approve`s) whose native-XTZ output auto-forwards to your Michelson account, which can then fund a Michelson op (e.g. a marketplace purchase) — all in one atomic, single-signature group.

## Install

```sh
npm i @baking-bad/free-route-tezos-x
```

Requires **Node ≥ 20** or a modern browser (uses the global `fetch`; on older runtimes pass your own via the `fetch` option). You also need `@taquito/taquito` to sign the ops it returns.

## Quick start

Buy an XTZ-priced objkt NFT paying USDC, in one atomic group:

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
const swapOps = freeRoute.buildSwapOperation({
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

Just need a swap (no marketplace)? Stop after `buildSwapOperation` and send `swapOps`.

## API

| Export | What |
|---|---|
| `FreeRouteTezosX` | **main entry point** — free-route reads (`getTokens` / `getQuote` / `getSwap`) + op-builders (`buildSwapOperation` / `buildErc20Approve` / `buildCallEvm`), pre-wired for the chosen Tezos X network |
| `FreeRouteClient` | low-level HTTP client — free-route reads only; prefer `FreeRouteTezosX`, which also builds ops |
| `buildSwapOperation` | a free-route `/swap` response → ready-to-sign Tezos ops (approve(s) + swap) |
| `resolveApproval` / `readAllowance` | read an ERC20 allowance and pick the minimal safe `ApprovalMode` |
| `objkt.buildFulfillAsk` | objkt v4 `fulfill_ask` op |
| `buildBatchTransaction` | flatten ops into one atomic group |
| `targetForMinOut` | gross up an exact-out target so the post-slippage floor covers a hard minimum |
| `michelsonToEvmAlias` / `evmToMichelsonAlias` / `aliasOf` | map an address to its alias on the other runtime (tz1 → 0x, 0x → KT1, or auto-detect) |
| `toEvmUnits` / `fromEvmUnits`, `XTZ`, `XTZ_ADDRESS` | XTZ mutez ⇄ wei + the native-XTZ token |
| `tezosXMainnet` / `tezosXPreviewnet` | network presets (chainId + gateway) |

All builders accept options objects and return Taquito `ParamsWithKind` — you choose how to sign.

## Demo / scripts

The [`scripts/`](scripts) folder has an end-to-end demo on Tezos X previewnet (deploy an NFT + marketplace, list an ask, buy it). See [scripts/README.md](scripts/README.md).

## License

[MIT](LICENSE) © Baking Bad
