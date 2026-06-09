# Previewnet findings — validated facts

On-chain facts gathered on **Tezos X previewnet** that the SDK + contracts rely on. Superseded research has been
removed; only what is currently true is kept.

## Network
- EVM: chainId **128064**, `https://evm.previewnet.tezosx.nomadic-labs.com`.
- Michelson: `NetXY2oPPzkxUW1`, proto **024-PtTALLiN**, `https://michelson.previewnet.tezosx.nomadic-labs.com`.
- Constants: `hard_gas_limit_per_operation == per_block == 3,000,000`; cost_per_byte = 250 mutez;
  hard_storage_limit_per_operation = 60,000; max_micheline_bytes_limit = 50,000.

## Test accounts (throwaway, previewnet-only — see .env, gitignored)
- buyer `tz1QPS1T1g2eiLptTSG6qLTK1789Cwt1rH3e` → EVM alias `0x8B02895450dE0ce6B44160A2D0f1B2C84198DFa3`
- funded EOA `0xaED0AE38BAfE53CDC12dD27d87393C968AC8EFB7`

## Gateways
- **Michelson→EVM** `KT18oDJJKXMKhfE1bSuAPGp92pYcwVDiqsPw`
  `%call_evm : pair (string %destination) (string %entrypoint) (bytes %data) (option (contract bytes) %callback)`.
  The XTZ sent into the EVM call is the operation `amount` (there is no value field in the type). `entrypoint` is
  the function **signature** string; `data` is the ABI-encoded **arguments only** (the gateway derives the selector).
- **EVM→Michelson** precompile (payable) `0xff..07 callMichelson(string,string,bytes)`.

## EVM alias
- One-way derivation: `alias = keccak256(utf8(base58check(tz1)))[:20]` (`tzToAlias` in the SDK).
- Reverse (alias → its Michelson KT1) via EVM RPC `tez_getEthereumTezosAddress(0x..)`.

## value(wei) → mutez at the gateway
| value wei | mutez |
|---|---|
| 1e12 | 1 |
| 1.999e12 | 1 |
| 2e12 | 2 |
| <1e12 | 0 (tx OK) |
**Rule: mutez = floor(wei / 1e12); sub-mutez dust is silently dropped, no revert.** To pay an ask of `price`
mutez, the bridge must deliver ≥ `price` mutez, i.e. swap output ≥ `price * 1e12` wei.

## Tezos-driven validation (the committed path)
- `call_evm` meters the EVM execution **separately** — the call_evm op consumed only **~17k** Michelson gas
  regardless of the heavy EVM swap. The per-op 3M cap is **not** charged the EVM swap.
- `callMichelson{value}` bridges XTZ to an **implicit tz1** directly (no escrow KT1 needed).
- `call_evm tokenIn.approve(SwapBridge)` runs **as the alias** and the allowance **persists**; the alias needs
  only the ERC20 (the tz1 pays the Michelson baker fee).
- **Op-group atomicity**: one batch `[approve?, call_evm swap+bridge, fulfill_ask]`; re-running on a SOLD ask →
  the whole group is rejected → the ERC20 is not pulled.
- **Gas rule for the SDK**: Σ of all batch ops' declared `gasLimit` must be ≤ 3M (per-op == per-block). The
  call_evm ops are ~17k; `fulfill_ask` gets most of the budget. The clean 2–3-op group fits.
- Live buys completed paying USDC, xU3O8, VNXAU — any-ERC20, real 3route router both directions.

## Taquito gotchas (previewnet) — handled by the SDK
- Default LOCAL forging produces bytes the node rejects (`invalid_signature`) → use **RpcForger** (remote forge).
- Auto fee/gas estimation is unreliable: auto-fee undershoots the node floor (`insufficient_fees`), and a
  `call_evm` op needs an explicit `gasLimit` to back the cross-runtime EVM execution (else a 400 cross-runtime
  error). → the SDK **pins** `fee`/`gasLimit`/`storageLimit` (config `DEFAULTS`); overridable per op.

## DEX / swap
- 3route **UniversalRouter `0x25896fd23d41c1d9F8779afc0D8AA3f52ca743Dc`** over xDex (IguanaV3, a Pancake-V3 fork),
  served by the local **rust-3route** server (1inch-v6.1 API, exact-out). Native sentinel dst `0xeee…eee`.
- Tokens on 128064: USDC `0x39fD36e60A839DE4cB5DaE0E1009c0aa612Bfba1` (6d), xU3O8 (18d), VNXAU (18d),
  WXTZ `0xf4a2e3BA5C14f11c23c8c4351093C058D20542f2` (18d). Routes go X→USDC→WXTZ→XTZ (IguanaV3 + NativeWrapper).
- Pool liquidity on previewnet is small → use micro amounts in tests.

## Objkt v4
- Mainnet v4 `KT1SwbTqhSKF6Pdokiu1K4Fpi17ahPPzmt1X`. Re-originated **faithfully, UNPATCHED** on previewnet:
  marketplace `KT1DzhZkEN8UZ6NkhGMDbgHh2W5zLqHDq4G7`, permission_module `KT1Exqw…`, fee_registry `KT1Kbev…`;
  test FA2 `KT1Mv4XGEJCvaqY8YmkU4NgDzQme5zwzSbCi`. v4 is monolithic inline code (no lambdas); all its `SUB`s are
  on `nat` (SUB;ISNAT), so it originates as-is on proto 024 (no mutez-`SUB` issue).
- Buy entrypoint = **`fulfill_ask`** (verified against the mainnet ABI; `%collect` is objkt.com's UI label, there
  is no such on-chain entrypoint). Value = right-comb `pair(nat %ask_id, nat %amount(editions), option %proxy_for,
  option %condition_extra, map %referrers address→nat)`; pass `(ask_id, 1, None, None, {})`.
- Requires `AMOUNT ≥ ask.price` and `ask.creator != SENDER`; **NFT → SENDER** (= the buyer tz1 sourcing the op),
  so no separate delivery step is needed.

## Micheline value tags (reference)
Pair `0x0707`, Some `0x0509`, None `0x0306`, Unit `0x030b`, nat `0x00`+zarith, bytes `0x0a`+len32, seq `0x02`+len32.
