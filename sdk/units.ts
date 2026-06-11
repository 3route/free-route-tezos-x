// units.ts — amount conversions. Everything internal is bigint base units; these bridge the two XTZ
// scales. On Tezos X, XTZ has two on-chain representations: 6-dec mutez on the Michelson side and
// 18-dec wei on the EVM side. A swap quotes/settles in wei; fulfill_ask and op values are mutez.

export const XTZ_MUTEZ_DECIMALS = 6; // Michelson side
export const XTZ_WEI_DECIMALS = 18; // EVM side
const WEI_PER_MUTEZ = 10n ** BigInt(XTZ_WEI_DECIMALS - XTZ_MUTEZ_DECIMALS); // 10^12

// XTZ wei (EVM, 18-dec) -> mutez (Michelson, 6-dec). FLOORS — sub-mutez dust can't exist on Michelson,
// so a guaranteed-output wei floor maps to a mutez floor that's never above it.
export const xtzWeiToMutez = (wei: bigint): bigint => wei / WEI_PER_MUTEZ;

// XTZ mutez (Michelson) -> wei (EVM). Exact: mutez is the coarser unit, the scale-up loses nothing.
export const xtzMutezToWei = (mutez: bigint): bigint => mutez * WEI_PER_MUTEZ;

// Generic base-unit rescale between two decimal precisions. Floors when scaling down.
export const scaleUnits = (amount: bigint, fromDecimals: number, toDecimals: number): bigint =>
  toDecimals >= fromDecimals
    ? amount * 10n ** BigInt(toDecimals - fromDecimals)
    : amount / 10n ** BigInt(fromDecimals - toDecimals);
