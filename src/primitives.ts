export type MichelsonAddress = string; // tz1/tz2/tz3/tz4/KT1
export type EvmAddress = string; // 0x… 20-byte EVM address
export type Hex = string; // 0x-prefixed hex
export type Nat = bigint | number | string; // any nat representation the michelson-encoder accepts
