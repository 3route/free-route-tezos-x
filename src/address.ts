import { getAddress as getEvmAddress, isAddress as isEvmAddress, keccak256, toUtf8Bytes } from 'ethers';
import { Prefix, ValidationResult, b58cencode, prefix, validateAddress as validateMichelsonAddress } from '@taquito/utils';
import { blake2b } from '@noble/hashes/blake2';
import type { EvmAddress, MichelsonAddress } from './primitives.js';

/** Michelson address → its EVM alias (0x). */
export const michelsonToEvmAlias = (michelsonAddress: MichelsonAddress): EvmAddress =>
  getEvmAddress('0x' + keccak256(toUtf8Bytes(michelsonAddress)).slice(2, 42));

/** EVM address → its Michelson alias (KT1). */
export const evmToMichelsonAlias = (evmAddress: EvmAddress): MichelsonAddress => {
  const lower = getEvmAddress(evmAddress).toLowerCase();
  return b58cencode(blake2b(toUtf8Bytes(lower), { dkLen: 20 }), prefix[Prefix.KT1]);
};

/** Resolve an address to its alias on the other runtime (tz→EVM, EVM→KT1). */
export const aliasOf = (address: MichelsonAddress | EvmAddress): MichelsonAddress | EvmAddress => {
  if (isEvmAddress(address)) return evmToMichelsonAlias(address);
  if (validateMichelsonAddress(address) === ValidationResult.VALID) return michelsonToEvmAlias(address);
  throw new Error(`not a valid EVM or Michelson address: ${address}`);
};
