import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { keccak256 } from '../../core/evm.js';
import { xtzMutezToWei } from '../../core/units.js';
import type { EvmAddress, EvmTxRequest, Hex, MichelsonAddress } from '../../core/primitives.js';

// ── dynamic ABI for the EVM→Michelson gateway: callMichelson(string,string,bytes) ──
const word = (n: number | bigint): string => BigInt(n).toString(16).padStart(64, '0');
const padRight32 = (hex: string): string => hex + '0'.repeat((64 - (hex.length % 64)) % 64);
const dynArg = (bytes: Uint8Array): string => word(bytes.length) + padRight32(bytesToHex(bytes)); // len word + right-padded data

/**
 * ABI-encode an EVM→Michelson gateway `callMichelson(string destination, string entrypoint, bytes data)`
 * call (selector + the three dynamic args). `data` is the FORGED Michelson value (no 0x05 PACK tag).
 */
export const encodeCallMichelson = (destination: string, entrypoint: string, data: Hex): Hex => {
  const parts = [utf8ToBytes(destination), utf8ToBytes(entrypoint), hexToBytes(data.replace(/^0x/, ''))].map(dynArg);
  const head = 96; // three 32-byte offset words
  const sizes = parts.map((p) => p.length / 2);
  const offsets = [head, head + sizes[0]!, head + sizes[0]! + sizes[1]!];
  const selector = keccak256('callMichelson(string,string,bytes)').slice(2, 10);
  return ('0x' + selector + offsets.map(word).join('') + parts.join('')) as Hex;
};

export interface BuildCallMichelsonTransactionOptions {
  destination: MichelsonAddress; // KT1 target contract (the precompile calls contracts, not implicit accounts)
  entrypoint: string;
  data: Hex; // forged Michelson value (no 0x05 PACK tag) — see forgeMichelson
  valueMutez?: bigint; // XTZ to forward; sent as msg.value in wei (×1e12)
  evmGateway: EvmAddress; // EVM→Michelson gateway precompile (EVM_GATEWAY)
}

/**
 * A native EVM tx invoking `destination.entrypoint(data)` on the Michelson side via the EVM→Michelson
 * gateway precompile (msg.sender on Michelson = the EVM account's KT1 alias). The mirror of `buildCallEvmOperation`.
 */
export const buildCallMichelsonTransaction = (o: BuildCallMichelsonTransactionOptions): EvmTxRequest => ({
  to: o.evmGateway,
  data: encodeCallMichelson(o.destination, o.entrypoint, o.data),
  value: xtzMutezToWei(o.valueMutez ?? 0n),
});
