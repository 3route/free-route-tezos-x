// address.ts — the two address spaces of a Tezos X account and the one-way bridge between them.
// A Michelson account (tz1.../KT1...) has a derived EVM *alias*: the EVM-side identity that holds
// ERC20s and acts as msg.sender when an operation runs through call_evm. The alias is derived from the
// Michelson address STRING, NOT from the account's public key — so it differs from a wallet's
// key-derived EVM address (e.g. Temple displays both, and they are unrelated).
import { getAddress, keccak256, toUtf8Bytes } from 'ethers';

export type MichelsonAddress = string; // tz1.../tz2.../tz3.../KT1...
export type EvmAddress = string; // 0x… (checksummed)
export type Hex = string; // 0x-prefixed hex blob

const isMichelson = (a: string): boolean => /^(tz[123]|KT1)/.test(a);

// Michelson address -> its EVM alias (one-way): first 20 bytes of keccak256(utf8(address-string)).
export const michelsonToAlias = (michelsonAddress: MichelsonAddress): EvmAddress =>
  getAddress('0x' + keccak256(toUtf8Bytes(michelsonAddress)).slice(2, 42));

// Resolve any address to its EVM-side identity: a Michelson address -> its alias; an EVM address ->
// itself (checksummed). Convenience for swap `from`/`receiver`, which are always EVM-side.
export const aliasOf = (address: MichelsonAddress | EvmAddress): EvmAddress =>
  isMichelson(address) ? michelsonToAlias(address) : getAddress(address);
