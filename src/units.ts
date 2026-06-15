export const XTZ_MUTEZ_DECIMALS = 6;
export const XTZ_WEI_DECIMALS = 18;
const WEI_PER_MUTEZ = 10n ** BigInt(XTZ_WEI_DECIMALS - XTZ_MUTEZ_DECIMALS); // 10^12

/** XTZ wei (EVM) → mutez (Michelson). Floors — a guaranteed wei floor maps to a mutez floor never above it. */
export const xtzWeiToMutez = (wei: bigint): bigint => wei / WEI_PER_MUTEZ;

/** XTZ mutez (Michelson) → wei (EVM). Exact — scaling up loses nothing. */
export const xtzMutezToWei = (mutez: bigint): bigint => mutez * WEI_PER_MUTEZ;
