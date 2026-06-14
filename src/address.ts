// The two address spaces of a Tezos X account. A Michelson account (tz1…/KT1…) has a derived EVM *alias* —
// the EVM-side identity that holds ERC20s and is msg.sender under call_evm. It is derived from the address
// STRING, not the public key, so it differs from a wallet's key-derived EVM address.
import { getAddress, keccak256, toUtf8Bytes } from 'ethers';

export type MichelsonAddress = string; // tz1/tz2/tz3/tz4/KT1
export type EvmAddress = string; // 0x… (checksummed)
export type Hex = string; // 0x-prefixed hex

const isMichelson = (a: string): boolean => /^(tz[1234]|KT1)/.test(a);

/** Michelson address → its EVM alias (one-way): first 20 bytes of keccak256(utf8(address)). */
export const michelsonToAlias = (michelsonAddress: MichelsonAddress): EvmAddress =>
  getAddress('0x' + keccak256(toUtf8Bytes(michelsonAddress)).slice(2, 42));

/** Resolve any address to its EVM-side identity: a Michelson address → its alias, an EVM address → itself (checksummed). */
export const aliasOf = (address: MichelsonAddress | EvmAddress): EvmAddress =>
  isMichelson(address) ? michelsonToAlias(address) : getAddress(address);
