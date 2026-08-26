import { OpKind } from '@taquito/taquito';
import type { ParamsWithKind } from '@taquito/taquito';
import { ParameterSchema } from '@taquito/michelson-encoder';
import type { EvmAddress, Hex, MichelsonAddress, OpLimits } from '../../core/primitives.js';

const callEvm = new ParameterSchema({
  prim: 'pair',
  args: [
    { prim: 'string' },
    { prim: 'string' },
    { prim: 'bytes' },
    { prim: 'option', args: [{ prim: 'contract', args: [{ prim: 'bytes' }] }] },
  ],
});

export interface BuildCallEvmOperationOptions {
  michelsonGateway: MichelsonAddress;
  dest: EvmAddress;
  sig: string; // e.g. 'approve(address,uint256)'
  abiargs: Hex; // ABI-encoded arguments ONLY — no selector (the gateway derives it from sig)
  valueMutez?: bigint; // msg.value in mutez (1e6); the gateway expands ×1e12 to wei
  callback?: MichelsonAddress | null; // `contract bytes` address to receive the EVM return bytes; null = none
  limits?: OpLimits; // offline pin (see callEvmGas); replaced by `estimateMichelsonOperation` when sizing online
}

/**
 * A `call_evm` op invoking `dest.sig(abiargs)` via the gateway (alias = msg.sender). Pure builder. Size it with
 * `limits` (offline, via {@link callEvmGas}) or, preferably, run the group through `estimateMichelsonOperation`
 * before signing — a bare Taquito/wallet estimate undershoots the cross-runtime call (see call-evm-limits).
 */
export const buildCallEvmOperation = (o: BuildCallEvmOperationOptions): ParamsWithKind => ({
  kind: OpKind.TRANSACTION,
  to: o.michelsonGateway,
  amount: Number(o.valueMutez ?? 0n),
  mutez: true,
  parameter: {
    entrypoint: 'call_evm',
    value: callEvm.Encode(o.dest, o.sig, o.abiargs, o.callback ?? null),
  },
  ...(o.limits ?? {}),
});

/** Is this op a cross-runtime `call_evm` call (the ops that need a gas margin over the node's estimate)? */
export const isCallEvmOperation = (op: ParamsWithKind): boolean =>
  op.kind === OpKind.TRANSACTION && op.parameter?.entrypoint === 'call_evm';
