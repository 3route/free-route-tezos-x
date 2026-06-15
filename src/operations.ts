import { OpKind } from '@taquito/taquito';
import type { ParamsWithKind } from '@taquito/taquito';
import { AbiCoder } from 'ethers';
import type { EvmAddress, Hex } from './primitives.js';

/** 3route UniversalRouter swap signature (selector 0x2dbbf153); call_evm takes the sig + calldata-minus-selector. */
export const SWAP_SIG =
  'swap(uint256,uint256,address,uint256,uint256,(address[],uint256),(address,uint256)[],(address,uint256,uint256))';
const SIG_APPROVE = 'approve(address,uint256)';
const abi = AbiCoder.defaultAbiCoder();

/**
 * A `call_evm` op running `dest.sig(abiargs)` via the gateway (alias = msg.sender). `valueMutez` > 0 forwards
 * that XTZ as the EVM msg.value — used for native-XTZ-input swaps.
 */
export const buildCallEvm = (
  gateway: string,
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
    value: { prim: 'Pair', args: [{ string: dest }, { string: sig }, { bytes: abiargs.replace(/^0x/, '') }, { prim: 'None' }] },
  },
  // pinned — previewnet's auto-fee undershoots the cross-runtime call_evm floor
  gasLimit: 500_000,
  storageLimit: 2_000,
  fee: 150_000,
});

/** ERC20 `approve(spender, amount)` via call_evm — lets the 3route router pull `amount` of `token` from the alias. */
export const buildErc20Approve = (gateway: string, token: EvmAddress, spender: EvmAddress, amount: bigint): ParamsWithKind =>
  buildCallEvm(gateway, token, SIG_APPROVE, abi.encode(['address', 'uint256'], [spender, amount]) as Hex);

/** Flatten ops/op-groups into one ordered atomic batch, e.g. `buildBatchTransaction(swapOps, fulfillOp)`. */
export const buildBatchTransaction = (...operations: Array<ParamsWithKind | ParamsWithKind[]>): ParamsWithKind[] => operations.flat();
