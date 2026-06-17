import type { ParamsWithKind } from '@taquito/taquito';
import { AbiCoder } from 'ethers';
import { buildCallEvm } from './call-evm.js';
import { callEvmGas } from '../call-evm-limits.js';
import type { CallEvmLimits } from '../call-evm-limits.js';
import type { EvmAddress, Hex, MichelsonAddress } from '../primitives.js';

const SIG_APPROVE = 'approve(address,uint256)';
const abi = AbiCoder.defaultAbiCoder();
const APPROVE_GAS = 12_000; // ERC20 approve via call_evm: measured floor ~3.5k, pinned with headroom

export interface BuildErc20ApproveOptions {
  gateway: MichelsonAddress;
  token: EvmAddress;
  spender: EvmAddress;
  amount: bigint;
  limits?: CallEvmLimits;
}

/** ERC20 `approve(spender, amount)` via call_evm — lets `spender` pull up to `amount` of `token` from the alias. */
export const buildErc20Approve = (o: BuildErc20ApproveOptions): ParamsWithKind =>
  buildCallEvm({
    gateway: o.gateway,
    dest: o.token,
    sig: SIG_APPROVE,
    abiargs: abi.encode(['address', 'uint256'], [o.spender, o.amount]) as Hex,
    limits: o.limits ?? callEvmGas.fixed(APPROVE_GAS),
  });
