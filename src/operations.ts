import { OpKind } from '@taquito/taquito';
import type { ParamsWithKind } from '@taquito/taquito';
import { ParameterSchema } from '@taquito/michelson-encoder';
import { AbiCoder } from 'ethers';
import type { EvmAddress, Hex, MichelsonAddress } from './primitives.js';

const SIG_APPROVE = 'approve(address,uint256)';
const abi = AbiCoder.defaultAbiCoder();

const callEvm = new ParameterSchema({
  prim: 'pair',
  args: [
    { prim: 'string' },
    { prim: 'string' },
    { prim: 'bytes' },
    { prim: 'option', args: [{ prim: 'contract', args: [{ prim: 'bytes' }] }] },
  ],
});

/**
 * A `call_evm` op running `dest.sig(abiargs)` via the gateway (alias = msg.sender).
 * `valueMutez` > 0 forwards that XTZ as the EVM call's msg.value — passed in mutez (1e6);
 * the gateway expands it to wei (×1e12) on the EVM side.
 */
export const buildCallEvm = (
  gateway: MichelsonAddress,
  dest: EvmAddress,
  sig: string,
  abiargs: Hex,
  valueMutez = 0n,
): ParamsWithKind => ({
  kind: OpKind.TRANSACTION,
  to: gateway,
  amount: Number(valueMutez),
  mutez: true,
  parameter: {
    entrypoint: 'call_evm',
    value: callEvm.Encode(dest, sig, abiargs, null),
  },
  // pinned — previewnet's auto-fee undershoots the cross-runtime call_evm floor
  gasLimit: 500_000,
  storageLimit: 2_000,
  fee: 150_000,
});

/** ERC20 `approve(spender, amount)` via call_evm — lets `spender` pull up to `amount` of `token` from the alias. */
export const buildErc20Approve = (gateway: MichelsonAddress, token: EvmAddress, spender: EvmAddress, amount: bigint): ParamsWithKind =>
  buildCallEvm(gateway, token, SIG_APPROVE, abi.encode(['address', 'uint256'], [spender, amount]) as Hex);

/** Concatenate ops/op-groups into one ordered list to sign as a single batch (atomic when sent as one group),
 *  e.g. `buildBatchTransaction(swapOps, fulfillOp)`. */
export const buildBatchTransaction = (...operations: Array<ParamsWithKind | ParamsWithKind[]>): ParamsWithKind[] => 
  operations.flat();
