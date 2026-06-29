# AGENTS.md

Guidance for AI coding agents working in **@baking-bad/free-route-tezos-x** — a TypeScript SDK that turns
[free-route](https://free-route.io) swaps on **Tezos X** into ready-to-sign Tezos operations. It prepares calls
for whichever runtime signs (Michelson / Tezlink **or** EVM / Etherlink); it never holds keys or broadcasts.

Human docs: [`README.md`](README.md) (full API + examples) · runnable demo: [`scripts/`](scripts).

## Commands

```bash
npm run check     # tsc --noEmit — type-check (run this after edits)
npm run lint      # eslint .
npm test          # tsx --test src/tests/*/*.test.ts — unit tests, fully offline (mocked fetch, fixtures)
npm run build     # rm -rf dist && tsc -p tsconfig.build.json -> dist/

# manual end-to-end on previewnet (NOT automated tests — need scripts/.env, see scripts/README.md):
npm run setup                 # deploy FA2 + objkt, list an ask
npm run example-buy:michelson # buy from the tz1 side
npm run example-buy:evm       # buy from the 0x side
npm run bridge:michelson | bridge:evm | addresses:michelson | addresses:evm
```

Always finish a change with `npm run check` and `npm test`. Node ≥ 20, ESM (`"type": "module"` — use `.js`
specifiers in relative imports even from `.ts` source).

## Layout

```
src/core/         # runtime-agnostic: address aliases, units, free-route client/dto, approval, slippage, networks, evm encoding
src/core/free-route/  # FreeRouteClient (keyed HTTP reads) + Quote/Swap models + DTO serialize/parse
src/michelson/    # Michelson side: call_evm op, swap/approve ops, batch, facade (Taquito ParamsWithKind)
src/evm/          # EVM side: callMichelson tx, swap/approve txs, forgeMichelson, facade (EvmTxRequest)
src/objkt/        # objkt v4 marketplace fulfill_ask builders (michelson.ts / evm.ts / shared ask.ts)
src/tests/        # node:test unit tests mirroring core/ michelson/ evm/
scripts/          # manual previewnet demo (deploy, buy, bridge) — not part of `npm test`
```

## Mental model (read before touching builders)

Tezos X = one chain, two interfaces that call each other atomically in a single tx:

- **Michelson-native** (tz1 signs): op-group calls the EVM router via `call_evm` as the account's **EVM alias**
  (`0x` derived from tz1). Native-XTZ swap output lands on the alias, which **auto-forwards** it to the tz1; the
  tz1 then funds a Michelson op (e.g. a marketplace fulfill). One atomic, single-signature group.
- **EVM-native** (0x signs): the free-route `/swap` response is a raw EVM tx — send it directly. To reach a
  Michelson contract, wrap it in `callMichelson` as the account's **Michelson alias** (`KT1` derived from the 0x),
  so the NFT lands there. A wallet batches `approve + swap + fulfill` via EIP-5792 `wallet_sendCalls`.

Both gateway addresses are fixed per network (`EVM_GATEWAY` / `MICHELSON_GATEWAY`, exposed on every facade).

## Public API (three tiers — pick one, stay there)

1. **Facade**: `FreeRouteTezosX` (`.michelson.*` + `.evm.*`), or the side-only `FreeRouteTezosXMichelson` /
   `FreeRouteTezosXEvm`. Bundles reads + builders, pre-wired to a network. Use when one place holds the API key.
2. **Client + builder split** (keep the key server-side): `FreeRouteClient` (keyed reads) on the server +
   `createMichelsonOpsBuilder(network.michelsonGateway)` / `createEvmOpsBuilder(network.evmGateway)` (keyless) anywhere.
3. **Standalone builders** (low-level): `buildMichelsonSwapOperation`, `buildEvmSwapTransaction`,
   `buildCallMichelsonTransaction`, `objkt.build*FulfillAsk*`, `buildBatchTransaction`, … the plain fns the tiers wrap.

See the API table in [`README.md`](README.md#api) for the full export list. Key helpers: `michelsonToEvmAlias` /
`evmToMichelsonAlias` / `aliasOf`, `toEvmUnits` / `fromEvmUnits`, `resolveApproval`, `targetForMinOut`,
`forgeMichelson`, `tezosXMainnet` / `tezosXPreviewnet`.

## Conventions

- **Naming = return type.** Michelson builders end in `…Operation` and return Taquito `ParamsWithKind` (an
  *operation*); EVM builders end in `…Transaction` and return `EvmTxRequest` (a *transaction*). Keep the suffix
  matching the side.
- **Optional peer deps.** `@taquito/taquito` (Michelson) and `@taquito/michel-codec` (EVM) are *optional* peers —
  the `/michelson` and `/evm` entrypoints each pull only their own. Never import `@taquito/taquito` from EVM-side
  code, or `@taquito/michel-codec` from Michelson-side code, or you break the lighter single-side imports. `core/`
  must stay free of both (only `@noble/hashes` + `@taquito/utils`).
- **Units.** XTZ is canonical in **mutez** (6 dp). 18-dp **wei** appears only at the EVM boundary — convert with
  `toEvmUnits` / `fromEvmUnits` (ERC20s are identity; only XTZ scales ×/÷ 1e12). Subtract in wei *then* convert
  once; never `weiToMutez(a) - weiToMutez(b)` (floor-then-subtract leaks ±1 mutez).
- **Marketplace entrypoint** is objkt v4 `fulfill_ask` (with optional `proxy_for` recipient) — not `collect`.
- **API key never reaches the client.** Keyed reads (`FreeRouteClient`) stay server-side; builders are keyless.

## Gotchas

- **Exact-output is `/swap`-only.** `getSwap({ isExactOut: true })` works; the aggregator's `/quote` endpoint
  rejects exact-output (returns *quote_not_found* → HTTP 400). For a price/rate, use an **exact-input** quote (and
  on thin pools quote a *small* amount in the **direction you'll actually trade** — buy = token→XTZ — since the
  reverse direction misprices by the pool spread).
- **Atomicity is the safety net.** `buildBatchTransaction(...ops)` → one signed group; if the final op reverts
  (e.g. the ask was already filled) the whole group rolls back and the payer keeps their funds.
- **Tests are offline.** `npm test` mocks fetch / uses fixtures — no RPC. Real gateway flows live in `scripts/`
  and need a funded previewnet account + `scripts/.env`; they are **not** run by CI.
- **Forging.** `forgeMichelson` strips the `0x05` PACK tag — callMichelson data is the raw packed Micheline.

## Reference integration

The companion dApp [`@baking-bad/free-route-tezos-x-example`](https://github.com/3route/free-route-tezos-x-example)
(Next.js) exercises every flow (buy / bridge / mint-list) from both wallet sides and shows the server/client key
split — the canonical example of consuming this SDK.
