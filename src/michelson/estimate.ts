// Online sizing for a Michelson op-group: simulate on the node, then size the `call_evm` ops with a margin — what
// the Tezos X docs recommend ("simulated limits may need a margin"). Robust to changes of the gas conversion
// coefficient, unlike the offline pins in call-evm-limits.ts (the builders' default when this is not used).
import { feeParamsFromMempoolFilter } from '@taquito/taquito';
import type { ParamsWithKind, TezosToolkit } from '@taquito/taquito';
import { CALL_EVM_ESTIMATE_MARGIN, CALL_EVM_GAS_CAP, CALL_EVM_STORAGE_LIMIT } from './call-evm-limits.js';
import { isCallEvmOperation } from './operations/call-evm.js';
import type { OpLimits } from '../core/primitives.js';

/** The part of a `TezosToolkit` this helper needs — signer- or wallet-backed; nothing is signed or sent. */
export type TezosEstimator = Pick<TezosToolkit, 'estimate' | 'rpc'>;

export interface EstimateMichelsonOperationOptions {
  tezos: TezosEstimator;
  /** The op-group to size, from `build*Operation` / `buildBatchTransaction`. Not mutated. */
  ops: ParamsWithKind[];
  /** Gas multiplier for call_evm ops. Default `CALL_EVM_ESTIMATE_MARGIN` (2). */
  margin?: number;
}

/**
 * Simulate `ops` as one group and return a copy with `gasLimit` / `storageLimit` / `fee` set on every op: call_evm
 * ops get the node's estimate × `margin` (fee scaled along, storage floored at `CALL_EVM_STORAGE_LIMIT`),
 * pure-Michelson ops keep the node's estimate as is.
 *
 * One simulation for the whole group, so it also checks the group end-to-end before signing (an already-filled
 * ask or a short balance fails here, not on-chain). Throws whatever the simulation throws — a revert is a real
 * error, not a sizing problem — and throws if a call_evm op's estimate alone exceeds `CALL_EVM_GAS_CAP`.
 *
 * Call it once, right before signing: Taquito's `estimate.batch` is several sequential RPC reads (wrap the RPC in
 * `RpcClientCache` to trim them), and `batch().send()` simulates again on its own. Without this helper the
 * builders' offline pins apply.
 */
export async function estimateMichelsonOperation(o: EstimateMichelsonOperationOptions): Promise<ParamsWithKind[]> {
  if (o.ops.length === 0) return [];
  const margin = o.margin ?? CALL_EVM_ESTIMATE_MARGIN;

  // Simulate unpinned: with limits set, the node checks OUR limits instead of measuring its own.
  const bare = o.ops.map(stripLimits);
  // The node's fee rates (mempool/filter) — Taquito prices the estimate with them but does not expose them, and
  // on Tezos X the per-gas rate differs from the L1 default, so re-read them to price the added gas the same way.
  const [estimates, feeParams] = await Promise.all([
    o.tezos.estimate.batch(bare),
    o.tezos.rpc.getMempoolFilter({ include_default: true }).then(feeParamsFromMempoolFilter),
  ]);
  // An unrevealed source gets one reveal estimate prepended — align by the tail, reject anything else.
  const extra = estimates.length - bare.length;
  if (extra < 0 || extra > 1) throw new Error(`estimate returned ${estimates.length} entries for ${bare.length} ops`);
  const perOp = estimates.slice(-bare.length);

  return bare.map((op, i) => {
    const est = perOp[i]!;
    if (!isCallEvmOperation(op)) {
      return { ...op, gasLimit: est.gasLimit, storageLimit: est.storageLimit, fee: est.suggestedFeeMutez };
    }
    if (est.gasLimit > CALL_EVM_GAS_CAP) {
      throw new Error(`call_evm op ${i} estimates at ${est.gasLimit} gas, above the ${CALL_EVM_GAS_CAP} cap`);
    }
    const gasLimit = Math.min(CALL_EVM_GAS_CAP, Math.ceil(est.gasLimit * margin));
    return {
      ...op,
      gasLimit,
      storageLimit: Math.max(est.storageLimit, CALL_EVM_STORAGE_LIMIT),
      fee: Math.ceil(est.suggestedFeeMutez + (gasLimit - est.gasLimit) * feeParams.feePerGasMutez),
    };
  });
}

const LIMIT_KEYS: ReadonlyArray<keyof OpLimits> = ['fee', 'gasLimit', 'storageLimit'];
const stripLimits = (op: ParamsWithKind): ParamsWithKind =>
  Object.fromEntries(Object.entries(op).filter(([k]) => !LIMIT_KEYS.includes(k as keyof OpLimits))) as ParamsWithKind;
