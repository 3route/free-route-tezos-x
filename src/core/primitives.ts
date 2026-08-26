export type MichelsonAddress = string; // tz1/tz2/tz3/tz4/KT1
export type EvmAddress = string; // 0x… 20-byte EVM address
export type Hex = string; // 0x-prefixed hex
export type Nat = bigint | number | string; // any nat representation the michelson-encoder accepts

// Explicit Tezos operation limits (fee in mutez). Set on an op, Taquito/wallets use them instead of their own estimate.
export interface OpLimits {
  gasLimit: number;
  storageLimit: number;
  fee: number;
}

// A ready-to-sign EVM transaction request (for MetaMask / viem / ethers). No gas/fees — the wallet
// estimates them (a fixed gas can be rejected by the node; let the wallet size it).
export interface EvmTxRequest {
  to: EvmAddress;
  data: Hex;
  value: bigint; // wei (XTZ ×1e12 from mutez)
}
