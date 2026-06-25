// Sizing policy for cross-runtime `call_evm` ops. previewnet WORKAROUND: the node's simulation
// undershoots cross-runtime gas (starves the EVM side -> gateway 504/400) while pure-Michelson
// estimation is already accurate, so we size these limits ourselves from the EVM gas estimate
// instead of trusting Taquito's estimation. When the node simulates cross-runtime gas accurately,
// drop this module and pass no `limits`. Measured: min ≈ 9200 + evmGas/27.5 (R²≈1, ~300k EVM
// gas/hop); formulas below keep ~2.5x headroom.

import type { OpLimits } from '../core/primitives.js';

const SWAP_GAS_CAP = 1_500_000; // backstop vs an anomalous estimate (~49 hops)

// fee slope 0.125 > the 0.1 µtz/gas minimal, so it covers the gas + byte terms; storage ~0 for call_evm.
const complete = (gasLimit: number, storageLimit = 350): OpLimits => ({
  gasLimit,
  storageLimit,
  fee: 1000 + Math.ceil(gasLimit / 8),
});

export const callEvmGas = {
  /** Size from an EVM gas estimate (e.g. free-route `swap.tx.gas`); adapts to route hops. */
  fromEvmEstimate(evmGas: bigint): OpLimits {
    const gasLimit = evmGas > 0n
      ? Math.min(SWAP_GAS_CAP, 20_000 + Math.ceil(Number(evmGas) / 10))
      : 500_000;
    return complete(gasLimit);
  },
  /** Size from a known fixed Tezos gas (e.g. an ERC20 approve). */
  fixed(gasLimit: number): OpLimits {
    return complete(gasLimit);
  },
};
