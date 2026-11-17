import { PrefixV2, ValidationResult, b58DecodeAndCheckPrefix, b58Encode, validateAddress as validateMichelsonAddress } from '@taquito/utils';
import { blake2b } from '@noble/hashes/blake2.js';
import { concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { getEvmAddress, isEvmAddress, keccak256 } from './evm.js';
import type { EvmAddress, MichelsonAddress } from './primitives.js';

// Recoverable EVM aliases (RFC-26051, Etherlink 8.0 "Horus", tezos/tezos!23037 + !23102). The EVM alias of a
// tz1/tz2/tz3 is the CREATE2 address — through the Safe singleton factory — of a rescue-account clone bound to the
// account's key hash, so it can be redeployed (and its funds recovered) on any EVM chain. Constants are the
// kernel's `RESCUE_*` (artifacts/frozen.json of trilitech/tz-alias-recovery @ b42336e) and must never change.
const RESCUE_SAFE_FACTORY = 'ff914d7fec6aac8cd542e72bca78b30650d45643d7'; // 0xff ‖ factory, CREATE2 prefix
const RESCUE_SALT = '9b8bb449a3d23b110d8c46424ba9b40748ac28bc7b99b7422a272950e17bb1d8'; // keccak256("tezosx.rescue.v1")
const RESCUE_GUARD = '3822d2fe3dce6ce4f4c7f274e2415fa3fae66c3e';
const RESCUE_IMPL: Partial<Record<PrefixV2, string>> = {
  [PrefixV2.Ed25519PublicKeyHash]: 'fee60e905d91905df9cd6bf8153976e9d77d5051', // TezosAccountTz1
  [PrefixV2.Secp256k1PublicKeyHash]: '47c81e55f51344d80a8e85c2add86257b51ea3d2', // TezosAccountTz2
  [PrefixV2.P256PublicKeyHash]: '894b62c61b208184b80fd72803811ba35d818112', // TezosAccountTz3
};
// Clone initcode = PREFIX(guard) ‖ EIP-1167 proxy(impl) ‖ pkh.
const PREFIX_HEAD = '73';
const PREFIX_TAIL = '3b15601e57600080fd5b604180602a6000396000f3';
const PROXY_HEAD = '363d3d373d3d3d363d73';
const PROXY_TAIL = '5af43d82803e903d91602b57fd5bf3';

const IMPLICIT_PREFIXES = [
  PrefixV2.Ed25519PublicKeyHash,
  PrefixV2.Secp256k1PublicKeyHash,
  PrefixV2.P256PublicKeyHash,
  PrefixV2.BLS12_381PublicKeyHash,
] as const;

// tz1/tz2/tz3 → recoverable alias; anything else (KT1, tz4) → undefined (keeps the legacy derivation).
const recoverableAlias = (michelsonAddress: string): EvmAddress | undefined => {
  if (!/^tz[123]/.test(michelsonAddress)) return undefined;
  const [pkh, prefix] = b58DecodeAndCheckPrefix(michelsonAddress, IMPLICIT_PREFIXES);
  const impl = RESCUE_IMPL[prefix];
  if (!impl) return undefined;
  const initcode = concatBytes(
    hexToBytes(PREFIX_HEAD + RESCUE_GUARD + PREFIX_TAIL + PROXY_HEAD + impl + PROXY_TAIL),
    pkh,
  );
  const initcodeHash = keccak256(initcode).slice(2);
  return getEvmAddress('0x' + keccak256(hexToBytes(RESCUE_SAFE_FACTORY + RESCUE_SALT + initcodeHash)).slice(26));
};

/** Pre-RFC-26051 derivation: first 20 bytes of keccak256(b58check address). Still used for KT1/tz4. */
export const legacyMichelsonToEvmAlias = (michelsonAddress: MichelsonAddress): EvmAddress =>
  getEvmAddress('0x' + keccak256(michelsonAddress).slice(2, 42));

/**
 * Michelson address → its EVM alias (0x). tz1/tz2/tz3 get the recoverable (CREATE2 rescue-account) alias;
 * KT1/tz4 keep the legacy Keccak-256 alias — mirroring the kernel's `compute_alias`.
 */
export const michelsonToEvmAlias = (michelsonAddress: MichelsonAddress): EvmAddress =>
  recoverableAlias(michelsonAddress) ?? legacyMichelsonToEvmAlias(michelsonAddress);

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
