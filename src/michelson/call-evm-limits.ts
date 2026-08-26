// Sizing policy for cross-runtime `call_evm` ops (offline default — no RPC needed).
//
// Why pin at all: on Tezos X the Michelson gas_limit an op DECLARES is converted into the EVM budget of the
// nested call (see https://x.tezos.com/docs/overview/resources — coefficient `c`, "simulated limits may need a
// margin"). The node's simulation reports what the op CONSUMES, and for call_evm that runs 0.94–1.37x short of
// the limit that must be declared (measured on proto 025 across 9 routes: single-hop / 5-pool splits / native
// vs ERC20 legs). Wallets and Taquito add only +100 gas on top of an estimate, so an unpinned call_evm swap fails
// with `tezlink_error`. Two ways to size it:
//   - offline (this module): derive from the EVM gas estimate the aggregator returns (`swap.tx.gas`);
//   - online (preferred when a TezosToolkit is at hand): simulate, then apply a margin — see estimate.ts.
//
// What `swap.tx.gas` is (rust-3route, swap.rs): execution estimate (base_overhead 200k + a per-hop table, e.g.
// IguanaV3 300k / NativeWrapper 77.5k) PLUS the L1 data (inclusion) surcharge the Etherlink-family node folds into
// the gas limit: 4000 gas/byte × (150 + calldata bytes). For a 5-pool split swap that is ≈1.4M execution + ≈5.1M
// L1 data = 6.52M — the L1 part dominates and scales with calldata size, not with work. We size from the TOTAL
// on purpose: it is a stable upper bound and needs no chain parameters here.
//
// Calibration (proto 025, PsUshuai): declared Michelson gas needed ≈ tx.gas / 485 (measured on 9 routes, e.g.
// 6.52M → 13.6k). The formula below keeps ~10x headroom over that and is capped BELOW the 660k per-op ceiling,
// so a future change of `c` can only cost fee, never a `gas_limit_too_high` rejection. `c` is benchmark-derived
// and did change 024 → 025 (~17x); re-measure when the protocol changes.

import type { OpLimits } from '../core/primitives.js';

/** Hard cap for a pinned call_evm gasLimit — stays under hard_gas_limit_per_operation (660k on previewnet). */
export const CALL_EVM_GAS_CAP = 600_000;

const EVM_GAS_DIVISOR = 48; // ≈ 10x headroom over the measured 1/485
const BASE_GAS = 10_000; // Michelson-side overhead of the gateway call
const FALLBACK_GAS = 100_000; // when no EVM estimate is available: ~7x the largest measured need

// fee slope 0.125 > the 0.1 µtz/gas minimal, so it covers the gas + byte terms; storage ~0 for call_evm.
const complete = (gasLimit: number, storageLimit = 350): OpLimits => ({
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
