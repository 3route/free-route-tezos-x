import { OpKind } from '@taquito/taquito';
import type { ParamsWithKind } from '@taquito/taquito';
import { ParameterSchema } from '@taquito/michelson-encoder';
import type { CallEvmLimits } from '../call-evm-limits.js';
import type { EvmAddress, Hex, MichelsonAddress } from '../primitives.js';

const callEvm = new ParameterSchema({
  prim: 'pair',
  args: [
    { prim: 'string' },
    { prim: 'string' },
    { prim: 'bytes' },
    { prim: 'option', args: [{ prim: 'contract', args: [{ prim: 'bytes' }] }] },
  ],
});

export interface BuildCallEvmOptions {
  gateway: MichelsonAddress;
  dest: EvmAddress;
  sig: string; // e.g. 'approve(address,uint256)'
  abiargs: Hex; // ABI-encoded arguments ONLY — no selector (the gateway derives it from sig)
  valueMutez?: bigint; // msg.value in mutez (1e6); the gateway expands ×1e12 to wei
  callback?: MichelsonAddress | null; // `contract bytes` address to receive the EVM return bytes; null = none
  limits?: CallEvmLimits; // fully sizes the op so no estimation runs; omit to let Taquito estimate
}

/**
 * A `call_evm` op invoking `dest.sig(abiargs)` via the gateway (alias = msg.sender). Pure builder: pass `limits`
 * (sized via {@link callEvmGas}) to fully specify the op so no estimation runs — required because estimation
 * undershoots the cross-runtime call; omit `limits` only to let Taquito estimate (inaccurate today, see call-evm-limits).
 */
export const buildCallEvm = (o: BuildCallEvmOptions): ParamsWithKind => ({
  kind: OpKind.TRANSACTION,
  to: o.gateway,
  amount: Number(o.valueMutez ?? 0n),
  mutez: true,
  parameter: {
    entrypoint: 'call_evm',
    value: callEvm.Encode(o.dest, o.sig, o.abiargs, o.callback ?? null),
  },
  ...(o.limits ?? {}),
});
