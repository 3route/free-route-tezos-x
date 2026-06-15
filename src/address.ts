import { getAddress, isAddress, keccak256, toUtf8Bytes } from 'ethers';
import { ValidationResult, validateAddress } from '@taquito/utils';

export type MichelsonAddress = string; // tz1/tz2/tz3/tz4/KT1
export type EvmAddress = string; // 0x… (checksummed)
export type Hex = string; // 0x-prefixed hex

/** Michelson address → its EVM alias (one-way): first 20 bytes of keccak256(utf8(address)). */
export const michelsonToAlias = (michelsonAddress: MichelsonAddress): EvmAddress =>
  getAddress('0x' + keccak256(toUtf8Bytes(michelsonAddress)).slice(2, 42));

/**
 * Resolve any address to its EVM-side identity: an EVM address → itself (checksummed), a valid Michelson
 * address → its alias. Validation (Base58Check prefix/checksum/length, EIP-55) is delegated to the deps, so a
 * malformed input fails fast instead of yielding a bogus alias.
 */
export const aliasOf = (address: MichelsonAddress | EvmAddress): EvmAddress => {
  if (isAddress(address)) return getAddress(address);
  if (validateAddress(address) === ValidationResult.VALID) return michelsonToAlias(address);
  throw new Error(`not a valid EVM or Michelson address: ${address}`);
};
