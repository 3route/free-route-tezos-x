# Changelog

All notable changes to **@baking-bad/free-route-tezos-x** are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Dates are UTC.

## [Unreleased]

## [0.4.0] — 2026-08-26

### Added

- **`estimateMichelsonOperation`** (facade / builder: `michelson.estimateOperation`) — simulate a Michelson op-group
  on the node and size it: `call_evm` ops get the node's estimate × `CALL_EVM_ESTIMATE_MARGIN` (2), fee priced at
  the node's rates (`mempool/filter`), storage floored at `CALL_EVM_STORAGE_LIMIT`; pure-Michelson ops keep the
  node's estimate. The recommended sizing at send time (per the Tezos X gas docs); the group is also checked
  end-to-end before signing. Takes a `TezosEstimator` (`Pick<TezosToolkit, 'estimate' | 'rpc'>`).
- `isCallEvmOperation`, `CALL_EVM_GAS_CAP`, `CALL_EVM_ESTIMATE_MARGIN`, `CALL_EVM_STORAGE_LIMIT` exports.
- README: "Gas on the Michelson side".

### Changed

- **`MichelsonOpsBuilder` gained a required `estimateOperation` member** — type-level breaking for code that
  implements or mocks the interface (the factory/facade implement it for you).
- **Offline `call_evm` gas pins recalibrated for previewnet proto 025** (`callEvmGas.fromEvmEstimate`:
  `10_000 + evmGas/48`, capped at `CALL_EVM_GAS_CAP` = 600k < the 660k per-op limit; fallback 100k). The previous
  `20_000 + evmGas/10` overshot the per-op limit once the aggregator started folding the L1 data surcharge into
  `tx.gas` (`gas_limit_too_high` on bridge swaps).

### Fixed

- Michelson bridge swaps (`XTZ → ERC20` on split routes) rejected with `gas_limit_too_high` on previewnet.

## [0.3.1] — 2026-06-29

> Tooling & docs only — the published library code (`dist/`) is unchanged from 0.3.0.

### Added

- `AGENTS.md` — guidance for AI coding agents (commands, layout, the two-runtime model, conventions, gotchas), with
  a `CLAUDE.md` that imports it so Claude Code and other tools share one source of truth.
- Demo scripts: optional NFT recipient (objkt `proxy_for`) on the buy flows and `receiver` on the swap flows.
- **Automated end-to-end tests against the previewnet gateway** (`npm run test:e2e`): buy, buy-with-recipient,
  bridge, and bridge-with-receiver from both wallet sides, asserting the on-chain outcome (FA2 NFT ownership,
  ERC20 received). Reuses the demo flow code, so the CLI scripts and the tests run the same path.

### Changed

- Internal: the demo flow scripts (`setup` / `example-buy` / `bridge`) are now each an exported function plus a thin
  CLI wrapper; the `npm run …` entrypoints and their behaviour are unchanged.

## [0.3.0] — 2026-06-26

### Changed

- **BREAKING — chain-idiomatic builder names + tiered API.** Builders are namespaced on the facade with the gateway
  pre-wired (`freeRoute.michelson.buildSwapOperation`, `freeRoute.evm.buildSwapTransaction`); the `…Operation`
  (Michelson `ParamsWithKind`) vs `…Transaction` (EVM `EvmTxRequest`) suffix now signals the return type. Three
  usage tiers: facade · client + builder split · standalone low-level builders.
- **BFF query codec.** Added `serializeQuoteQuery` / `parseQuoteQuery` (and the swap equivalents) so quotes and swaps
  cross an HTTP proxy boundary without losing their `bigint` fields — the basis for the client/server key split.

### Fixed

- Expose the `./package.json` subpath in the package `exports` map.

## [0.2.2] — 2026-06-25

### Added

- **EVM-native side.** Drive the same flow from a `0x` account: `buildEvmSwapTransaction`,
  `buildEvmApproveTransaction`, `buildCallMichelsonTransaction`, `objkt.buildEvmFulfillAskTransaction`, the
  `FreeRouteTezosXEvm` facade, and `forgeMichelson` (forge a Micheline value for `callMichelson` data).
- **Three import entrypoints with isolated peer deps.** `.` (both sides), `./michelson` (pulls `@taquito/taquito`
  only), `./evm` (pulls `@taquito/michel-codec` only); `core/` stays free of both.

## [0.2.1] — 2026-06-23

### Added

- Docs: "Keep your API key server-side" — the keyed `FreeRouteClient` (server) + keyless gateway-bound builders
  (`createMichelsonOpsBuilder` / `createEvmOpsBuilder`) split. No API changes.

## [0.2.0] — 2026-06-23

### Changed

- **BREAKING:** renamed `toEvm` / `fromEvm` → `toEvmUnits` / `fromEvmUnits`.
- Docs: clearer quick-start example.

## [0.1.2] — 2026-06-22

### Changed

- Dependency bumps: `@noble/hashes` 2.x, TypeScript 6, `@types/node` 26, `@taquito` dev deps aligned to `~24.3.0`.
- CI: least-privilege `contents: read` permissions on the workflow.

## [0.1.1] — 2026-06-22

Initial published release. Turns [free-route](https://free-route.io) swaps on Tezos X into ready-to-sign
**Michelson** operations — the Michelson-native (Temple) side.

### Added

- **Translation layer:** bidirectional tz1 ↔ EVM-alias resolvers (`michelsonToEvmAlias` / `evmToMichelsonAlias` /
  `aliasOf`, on-chain verified), mutez ↔ wei units (`toEvm` / `fromEvm`, `XTZ`), ABI / Micheline encoding, and the
  `call_evm` gateway operation.
- **Batch builders:** `buildMichelsonSwapOperation`, `buildMichelsonApproveOperation`, `buildBatchTransaction`,
  allowance-aware `resolveApproval`, and slippage `targetForMinOut` — plus the `FreeRouteTezosX` facade and the
  reads-only `FreeRouteClient`.
- **objkt v4:** `objkt.buildMichelsonFulfillAskOperation` (`fulfill_ask`, optional `proxy_for` recipient).
- ESM-only package (Node ≥ 20); `@taquito/*` as peer deps; hand-rolled EVM/ABI utils on `@noble/hashes` (no ethers).
  Unit tests, README, and a tag-triggered npm publish workflow.

[Unreleased]: https://github.com/3route/free-route-tezos-x/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/3route/free-route-tezos-x/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/3route/free-route-tezos-x/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/3route/free-route-tezos-x/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/3route/free-route-tezos-x/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/3route/free-route-tezos-x/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/3route/free-route-tezos-x/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/3route/free-route-tezos-x/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/3route/free-route-tezos-x/releases/tag/v0.1.1
