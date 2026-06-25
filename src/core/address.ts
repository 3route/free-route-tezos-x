import { PrefixV2, ValidationResult, b58Encode, validateAddress as validateMichelsonAddress } from '@taquito/utils';
import { blake2b } from '@noble/hashes/blake2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { getEvmAddress, isEvmAddress, keccak256 } from './evm.js';
import type { EvmAddress, MichelsonAddress } from './primitives.js';

/** Michelson address → its EVM alias (0x). */
export const michelsonToEvmAlias = (michelsonAddress: MichelsonAddress): EvmAddress =>
  getEvmAddress('0x' + keccak256(michelsonAddress).slice(2, 42));

/** EVM address → its Michelson alias (KT1). */
export const evmToMichelsonAlias = (evmAddress: EvmAddress): MichelsonAddress => {
  const lower = getEvmAddress(evmAddress).toLowerCase();
  return b58Encode(blake2b(utf8ToBytes(lower), { dkLen: 20 }), PrefixV2.ContractHash);
};

/** Resolve an address to its alias on the other runtime (tz→EVM, EVM→KT1). */
export const aliasOf = (address: MichelsonAddress | EvmAddress): MichelsonAddress | EvmAddress => {
  if (isEvmAddress(address)) return evmToMichelsonAlias(address);
  if (validateMichelsonAddress(address) === ValidationResult.VALID) return michelsonToEvmAlias(address);
  throw new Error(`not a valid EVM or Michelson address: ${address}`);
};
