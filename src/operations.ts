import { OpKind } from '@taquito/taquito';
import type { ParamsWithKind } from '@taquito/taquito';
import { ParameterSchema } from '@taquito/michelson-encoder';
import { AbiCoder } from 'ethers';
import type { EvmAddress, Hex, MichelsonAddress } from './primitives.js';

const SIG_APPROVE = 'approve(address,uint256)';
const abi = AbiCoder.defaultAbiCoder();
const APPROVE_GAS = 12_000; // ERC20 approve via call_evm: measured floor ~3.5k, pinned with headroom

const callEvm = new ParameterSchema({
  prim: 'pair',
  args: [
    { prim: 'string' },
    { prim: 'string' },
    { prim: 'bytes' },
    { prim: 'option', args: [{ prim: 'contract', args: [{ prim: 'bytes' }] }] },
  ],
});

export interface CallEvmOptions {
  valueMutez?: bigint; // XTZ forwarded as the EVM call's msg.value — in mutez (1e6); the gateway expands ×1e12 to wei
  gasLimit?: number; // pin the Tezos gas: call_evm estimation undershoots the cross-runtime cost, so the caller sizes it
  storageLimit?: number; // default 350 (call_evm allocates ~0 Tezos storage)
}

/**
 * A `call_evm` op running `dest.sig(abiargs)` via the gateway (alias = msg.sender). When `gasLimit` is given, the
 * op is fully sized (storage + a gas-derived fee) so no estimation runs — required because estimation undershoots
 * the cross-runtime call (it starves the EVM side; see {@link buildSwapOperation} for how the swap gas is derived).
 */
export const buildCallEvm = (
  gateway: MichelsonAddress,
  dest: EvmAddress,
  sig: string,
  abiargs: Hex,
  opts: CallEvmOptions = {},
): ParamsWithKind => ({
  kind: OpKind.TRANSACTION,
  to: gateway,
  amount: Number(opts.valueMutez ?? 0n),
  mutez: true,
  parameter: {
    entrypoint: 'call_evm',
    value: callEvm.Encode(dest, sig, abiargs, null),
  },
  ...(opts.gasLimit != null
    ? {
      gasLimit: opts.gasLimit,
      storageLimit: opts.storageLimit ?? 350,
      fee: 1000 + Math.ceil(opts.gasLimit / 8)
    }
    : {}),
});

/** ERC20 `approve(spender, amount)` via call_evm — lets `spender` pull up to `amount` of `token` from the alias. */
export const buildErc20Approve = (gateway: MichelsonAddress, token: EvmAddress, spender: EvmAddress, amount: bigint): ParamsWithKind => {
  return buildCallEvm(
    gateway,
    token,
    SIG_APPROVE,
    abi.encode(['address', 'uint256'], [spender, amount]) as Hex,
    { gasLimit: APPROVE_GAS }
  );
}

/** Concatenate ops/op-groups into one ordered list to sign as a single batch (atomic when sent as one group),
 *  e.g. `buildBatchTransaction(swapOps, fulfillOp)`. */
export const buildBatchTransaction = (...operations: Array<ParamsWithKind | ParamsWithKind[]>): ParamsWithKind[] =>
  operations.flat();
