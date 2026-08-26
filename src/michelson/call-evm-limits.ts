// Offline sizing for cross-runtime `call_evm` ops (no RPC). Preferred when a TezosToolkit is at hand:
// `estimateMichelsonOperation` (simulate, then apply a margin) — see estimate.ts.
//
// Why pin: the Michelson gas_limit an op declares becomes the EVM budget of the nested call (Tezos X gas model,
// https://x.tezos.com/docs/overview/resources). The node's simulation reports what is consumed, which runs up to
// ~1.4x short of what must be declared, and wallets/Taquito add only +100 gas — so an unpinned call_evm swap fails
// with `tezlink_error`.
//
// Calibration (previewnet, proto 025): declared gas needed ≈ `swap.tx.gas` / 485 (tx.gas = execution + the L1
// data surcharge the node folds into the limit; sizing from the total is a stable upper bound). The formula keeps
// ~10x headroom and is capped under the 660k per-op ceiling, so a change of the conversion coefficient (it is
// benchmark-derived and moves with protocol upgrades) can only cost fee, never a rejection. Re-measure on upgrades.

import type { OpLimits } from '../core/primitives.js';

/** Cap for a call_evm gasLimit (pinned or estimated) — under hard_gas_limit_per_operation (660k on previewnet). */
export const CALL_EVM_GAS_CAP = 600_000;

/** Multiplier over the node's estimate for call_evm ops (`estimateMichelsonOperation`); measured need is ≤1.4x. */
export const CALL_EVM_ESTIMATE_MARGIN = 2;

/** storageLimit floor for a call_evm op — storage is ~0 but unused limit is free, so keep a floor. */
export const CALL_EVM_STORAGE_LIMIT = 350;

const EVM_GAS_DIVISOR = 48; // ~10x headroom over the measured 1/485
const BASE_GAS = 10_000; // Michelson-side overhead of the gateway call
const FALLBACK_GAS = 100_000; // no EVM estimate available: ~7x the largest measured need

// fee slope 0.125 > the 0.1 µtz/gas minimal, so it covers the gas + byte terms.
const complete = (gasLimit: number, storageLimit = CALL_EVM_STORAGE_LIMIT): OpLimits => ({
  gasLimit,
  storageLimit,
  fee: 1000 + Math.ceil(gasLimit / 8),
});

export const callEvmGas = {
  /** Size from an EVM gas estimate (e.g. free-route `swap.tx.gas`); adapts to route size, capped under the op limit. */
  fromEvmEstimate(evmGas: bigint): OpLimits {
    const gasLimit = evmGas > 0n
      ? Math.min(CALL_EVM_GAS_CAP, BASE_GAS + Math.ceil(Number(evmGas) / EVM_GAS_DIVISOR))
      : FALLBACK_GAS;
    return complete(gasLimit);
  },
  /** Size from a known fixed Tezos gas (e.g. an ERC20 approve). */
  fixed(gasLimit: number): OpLimits {
    return complete(gasLimit);
  },
};
