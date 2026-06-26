import type { ParamsWithKind } from '@taquito/taquito';
import { buildCallEvmOperation } from './call-evm.js';
import { encodeArgs } from '../../core/evm.js';
import { callEvmGas } from '../call-evm-limits.js';
import type { EvmAddress, Hex, MichelsonAddress, OpLimits } from '../../core/primitives.js';

const SIG_APPROVE = 'approve(address,uint256)';
const APPROVE_GAS = 12_000; // ERC20 approve via call_evm: measured floor ~3.5k, pinned with headroom

export interface BuildMichelsonApproveOperationOptions {
  michelsonGateway: MichelsonAddress;
  token: EvmAddress;
  spender: EvmAddress;
  amount: bigint;
  limits?: OpLimits;
}

/** ERC20 `approve(spender, amount)` via call_evm — lets `spender` pull up to `amount` of `token` from the alias. */
export const buildMichelsonApproveOperation = (o: BuildMichelsonApproveOperationOptions): ParamsWithKind =>
  buildCallEvmOperation({
    michelsonGateway: o.michelsonGateway,
    dest: o.token,
    sig: SIG_APPROVE,
    abiargs: encodeArgs(SIG_APPROVE, [o.spender, o.amount]) as Hex,
    limits: o.limits ?? callEvmGas.fixed(APPROVE_GAS),
  });
