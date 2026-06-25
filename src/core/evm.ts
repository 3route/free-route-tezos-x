import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { EvmAddress, Hex } from './primitives.js';

/** keccak-256 of bytes (or a UTF-8 string) as 0x-hex. */
export const keccak256 = (data: Uint8Array | string): Hex =>
  ('0x' + bytesToHex(keccak_256(typeof data === 'string' ? utf8ToBytes(data) : data))) as Hex;

// EIP-55 checksum of a lowercase 40-hex string -> 0x-prefixed mixed-case address.
const toChecksum = (lowerHex: string): EvmAddress => {
  const hash = bytesToHex(keccak_256(utf8ToBytes(lowerHex))); // hash the lowercase hex string
  let out = '0x';
  for (let i = 0; i < 40; i++) out += parseInt(hash[i]!, 16) >= 8 ? lowerHex[i]!.toUpperCase() : lowerHex[i];
  return out as EvmAddress;
};

/** True for a valid 0x EVM address: all-lower / all-upper, or mixed-case with a correct EIP-55 checksum. */
export const isEvmAddress = (a: string): a is EvmAddress => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return false;
  const hex = a.slice(2);
  if (hex === hex.toLowerCase() || hex === hex.toUpperCase()) return true; // case-insensitive forms
  return a === toChecksum(hex.toLowerCase()); // mixed case must match the checksum
};

/** Validate + EIP-55 checksum an EVM address. Throws on bad format or a wrong mixed-case checksum. */
export const getEvmAddress = (a: string): EvmAddress => {
  if (!isEvmAddress(a)) throw new Error(`invalid EVM address: ${a}`);
  return toChecksum(a.slice(2).toLowerCase());
};

// ── minimal ABI codec for static `address` / `uint256` params ──
type AbiType = 'address' | 'uint256';
const MAX_UINT256 = 2n ** 256n - 1n;

const argTypes = (sig: string): AbiType[] => {
  const inner = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  return inner ? (inner.split(',') as AbiType[]) : [];
};

const encodeWord = (type: AbiType, v: EvmAddress | bigint): string => {
  if (type === 'address') return getEvmAddress(v as EvmAddress).slice(2).toLowerCase().padStart(64, '0');
  const n = v as bigint; // uint256
  if (n < 0n || n > MAX_UINT256) throw new Error(`uint256 out of range: ${n}`);
  return n.toString(16).padStart(64, '0');
};

/** ABI-encode a function's args (no selector), reading the types from its signature. */
export const encodeArgs = (sig: string, values: readonly (EvmAddress | bigint)[]): Hex =>
  ('0x' + argTypes(sig).map((t, i) => encodeWord(t, values[i]!)).join('')) as Hex;

/** 4-byte selector + ABI-encoded args — a ready eth_call `data`. */
export const encodeCall = (sig: string, values: readonly (EvmAddress | bigint)[]): Hex =>
  (keccak256(sig).slice(0, 10) + encodeArgs(sig, values).slice(2)) as Hex;

/** Decode a single uint256 word (0x-hex) to bigint. */
export const decodeUint256 = (hex: string): bigint => BigInt(hex);
