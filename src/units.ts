// XTZ amount conversions. On Tezos X, XTZ is 6-dec mutez (Michelson) and 18-dec wei (EVM): swaps settle in
// wei, op values / fulfill_ask in mutez. Every other token uses identical units on both sides.

export const XTZ_MUTEZ_DECIMALS = 6;
export const XTZ_WEI_DECIMALS = 18;
const WEI_PER_MUTEZ = 10n ** BigInt(XTZ_WEI_DECIMALS - XTZ_MUTEZ_DECIMALS); // 10^12

/** XTZ wei (EVM) → mutez (Michelson). Floors — a guaranteed wei floor maps to a mutez floor never above it. */
export const xtzWeiToMutez = (wei: bigint): bigint => wei / WEI_PER_MUTEZ;

/** XTZ mutez (Michelson) → wei (EVM). Exact — scaling up loses nothing. */
export const xtzMutezToWei = (mutez: bigint): bigint => mutez * WEI_PER_MUTEZ;

/** Rescale base units between two decimal precisions. Floors when scaling down. */
export const scaleUnits = (amount: bigint, fromDecimals: number, toDecimals: number): bigint =>
  toDecimals >= fromDecimals
    ? amount * 10n ** BigInt(toDecimals - fromDecimals)
    : amount / 10n ** BigInt(fromDecimals - toDecimals);
