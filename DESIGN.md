# Design — Tezos-driven buy: pay any EVM ERC20, buy an Objkt NFT priced in XTZ

A `tz1` user holds an ERC20 on their EVM alias and buys an Objkt NFT (priced in XTZ) by signing **one native
Tezos op-group** via Beacon/Temple. EVM is used only as the swap engine, invoked from Tezos through the
`call_evm` gateway; the resulting XTZ is bridged back to Michelson.

## Flow (one Beacon-signed Tezos op-group, all-or-nothing)
```
op0 (optional): call_evm -> tokenIn.approve(SwapBridge, amountIn)   // only if allowance is short; scoped
op1:            call_evm(gateway KT18oDJJ…, dest=SwapBridge, "swapAndBridgePull(...)", abiargs)
                  └─(EVM, msg.sender = caller tz1's alias)→
                       pull tokenIn from alias → 3route swap tokenIn→native XTZ → require ≥ minXtzOut
                       → refund unused tokenIn to caller → callMichelson{value: xtz}: bridge XTZ to recipient tz1
op2 (the consumer's own op): tz1 -> objkt.fulfill_ask{ amount = priceMutez }
                  └─ spends the bridged XTZ; NFT → SENDER (= buyer tz1) directly
```
**Atomicity** is the Tezos op-group itself: if `fulfill_ask` fails (NFT already sold) the whole group is
rejected → the swap/bridge roll back → the user keeps their ERC20. Validated on-chain (see below).

## Split: universal SDK core + consumer
- **SDK (`sdk/`)** builds the **universal** swap+bridge ops `[reset?, approve?, swapAndBridgePull]` from a quote.
  It is marketplace-agnostic and signer-agnostic (only builds `TransferParams`; you sign with Beacon or
  InMemorySigner). `quoteExactOut` takes any `tokenIn`.
- **Consumer (`example/`)** appends its own operation (objkt `fulfill_ask`) and runs the combined list through
  `buildBatchTransaction` to form the atomic op-group.

## `SwapBridge.sol` (on-chain, in `contracts/`)
```solidity
function swapAndBridgePull(
  address tokenIn, uint256 amountIn, uint256 minXtzOut,
  string michelsonRecipient, address router, bytes swapCalldata
) external nonReentrant;   // msg.sender = the calling tz1's EVM alias
```
Route-agnostic and hardened for any ERC20: OZ SafeERC20, `forceApprove`+revoke, balance-delta accounting,
`nonReentrant`+CEI, `minXtzOut` slippage floor, unused-input refund. The swap output is native XTZ to the
contract; the bridge is a value-bearing `callMichelson` (no 2300-gas-stipend problem of `WXTZ.withdraw`).
**Security model:** `router`/`swapCalldata` are untrusted and not validated — safety is the OUTPUT invariant
(≥ `minXtzOut` native bridged to the recipient, else atomic revert). Ownerless, no rescue. (NatSpec in the source.)

## Reused previewnet infra
- Michelson→EVM gateway `KT18oDJJKXMKhfE1bSuAPGp92pYcwVDiqsPw` `%call_evm(string dest, string sig, bytes abiargs, option callback)`.
- EVM→Michelson precompile (payable) `0xff..07 callMichelson(string,string,bytes)`.
- Swap: 3route UniversalRouter `0x25896fd2…` (xDex / IguanaV3 pools) + rust-3route exact-out server.
- Objkt v4 (for op2): `KT1DzhZkEN8UZ6NkhGMDbgHh2W5zLqHDq4G7` (faithful 1:1 re-origination); test FA2 `KT1Mv4X…`.

## Validated on-chain (previewnet)
- `call_evm` meters the EVM execution **separately** (~17k Michelson gas for the call_evm op regardless of the
  heavy EVM swap) — the old "3M Michelson cap blocks a swap" concern does not apply.
- `callMichelson{value}` bridges XTZ to an **implicit tz1** directly (no escrow KT1 needed).
- `approve` from the alias via `call_evm` persists (allowance survives) — the alias needs only the ERC20, no XTZ.
- **Op-group atomicity confirmed**: re-running the group on a SOLD ask → whole group rejected → ERC20 not pulled.
- Live buys completed paying **USDC, xU3O8 (uranium), VNXAU (gold)** — any-ERC20, real router both ways.

## Gas rule (for the SDK)
`hard_gas_limit_per_operation == hard_gas_limit_per_block == 3,000,000`. The sum of all batch ops' declared
`gasLimit` must be ≤ 3M. `call_evm` ops are ~17k Michelson gas, so `fulfill_ask` gets most of the budget. The
clean 2–3-op group fits. `buildBatchTransaction` enforces the Σ ≤ 3M guard.

## Why Tezos-driven
- The user signs **one native Tezos op-group** via Beacon — no EVM transaction to sign.
- The fee is a Michelson baker fee (XTZ) paid by the tz1; the alias only needs the ERC20.
- The marketplace call is a **separate Tezos op in the batch** — the SDK stays universal (any second op).
- Best fit to the user story: everything originates from Tezos.
