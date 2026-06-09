// Translation layer: address resolver, value conversion, ABI encoding.
import { ethers } from 'ethers';
import type { Tz1Address, EvmAddress, Hex, SwapBridgeArgs } from './types.js';

// alias = keccak256(utf8(base58check(tz1)))[:20] — one-way (tz1 -> EVM alias).
export const tzToAlias = (tz1: Tz1Address): EvmAddress =>
  ethers.getAddress('0x' + ethers.keccak256(ethers.toUtf8Bytes(tz1)).slice(2, 42));

// native XTZ scales x10^12 between Michelson mutez and EVM wei.
export const mutezToWei = (mutez: bigint | number | string): bigint => BigInt(mutez) * 10n ** 12n;
export const weiToMutez = (wei: bigint | number | string): bigint => BigInt(wei) / 10n ** 12n;

const abi = ethers.AbiCoder.defaultAbiCoder();

// The gateway derives the EVM selector from the sig string, so we ABI-encode only the *arguments*.
export const encodeApproveArgs = (spender: EvmAddress, amount: bigint): Hex =>
  abi.encode(['address', 'uint256'], [spender, amount]);

export const encodeSwapAndBridgePullArgs = (a: SwapBridgeArgs): Hex =>
  abi.encode(
    ['address', 'uint256', 'uint256', 'string', 'address', 'bytes'],
    [a.tokenIn, a.amountIn, a.minXtzOut, a.recipientTz1, a.router, a.swapCalldata],
  );

export const SIG_APPROVE = 'approve(address,uint256)';
export const SIG_SWAP_BRIDGE = 'swapAndBridgePull(address,uint256,uint256,string,address,bytes)';
