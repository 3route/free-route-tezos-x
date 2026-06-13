// operations.ts — Tezos operation builders for the Michelson->EVM gateway. Every EVM action (3route swap,
// ERC20 approve) is wrapped as a `call_evm` transaction: the gateway runs `dest.sig(abiargs)` on the EVM
// side with the alias as msg.sender. Limits are PINNED — on previewnet Taquito's auto-fee undershoots the
// floor and a call_evm needs an explicit gasLimit.
import { OpKind } from '@taquito/taquito';
import type { ParamsWithKind } from '@taquito/taquito';
import { AbiCoder } from 'ethers';
import type { EvmAddress, Hex } from './address.js';

// 3route UniversalRouter swap signature (selector 0x2dbbf153) — call_evm needs sig + (calldata minus selector).
export const SWAP_SIG =
  'swap(uint256,uint256,address,uint256,uint256,(address[],uint256),(address,uint256)[],(address,uint256,uint256))';
const SIG_APPROVE = 'approve(address,uint256)';
const abi = AbiCoder.defaultAbiCoder();

// A call_evm transaction. `valueMutez` > 0 forwards native XTZ as the EVM msg.value (native-XTZ-input swaps);
// the gateway relays the op's transferred tez as msg.value on the alias's EVM call.
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
  gasLimit: 500_000,
  storageLimit: 2_000,
  fee: 150_000,
});

// ERC20 approve(spender, amount) via call_evm — lets the 3route router pull `amount` of `token` from the alias.
export const buildErc20Approve = (gateway: string, token: EvmAddress, spender: EvmAddress, amount: bigint): ParamsWithKind =>
  buildCallEvm(gateway, token, SIG_APPROVE, abi.encode(['address', 'uint256'], [spender, amount]) as Hex);

// Assemble one atomic batch from operations/groups, in order. Accepts a mix of single ops and op-arrays
// (e.g. `buildBatchTransaction(swapOps, fulfillOp)`) and flattens them — the consumer signs/sends the result.
export const buildBatchTransaction = (...operations: Array<ParamsWithKind | ParamsWithKind[]>): ParamsWithKind[] => operations.flat();
