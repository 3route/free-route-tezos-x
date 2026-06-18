import type { EvmAddress } from './primitives.js';
import type { ThreeRouteToken } from './threeroute.js';

export const XTZ_MUTEZ_DECIMALS = 6;
export const XTZ_WEI_DECIMALS = 18;
const WEI_PER_MUTEZ = 10n ** BigInt(XTZ_WEI_DECIMALS - XTZ_MUTEZ_DECIMALS); // 10^12

/** XTZ wei (EVM) → mutez (Michelson). Floors — a guaranteed wei floor maps to a mutez floor never above it. */
export const xtzWeiToMutez = (wei: bigint): bigint => wei / WEI_PER_MUTEZ;

/** XTZ mutez (Michelson) → wei (EVM). Exact — scaling up loses nothing. */
export const xtzMutezToWei = (mutez: bigint): bigint => mutez * WEI_PER_MUTEZ;

/** Native-XTZ marker address — the single source of truth used to recognise XTZ everywhere. */
export const XTZ_ADDRESS: EvmAddress = '0x0000000000000000000000000000000000000000';

// decimals = 6 is the Michelson/mutez view the consumer works in; the EVM side bridges to 18-dec wei internally,
// so the registry's 18 is irrelevant here.
export const XTZ: ThreeRouteToken = { address: XTZ_ADDRESS, symbol: 'XTZ', name: 'Tez', decimals: 6 };

export const isXtz = (address: EvmAddress): boolean => address.toLowerCase() === XTZ_ADDRESS;

// Unit boundary — XTZ is mutez consumer-side, wei API-side; ERC20 is identical on both.
/** Convert a consumer-side amount to the EVM API's units (mutez→wei for XTZ; identity for ERC20). */
export const toEvm = (amount: bigint, address: EvmAddress): bigint => (isXtz(address) ? xtzMutezToWei(amount) : amount);
/** Convert an EVM-API amount back to consumer-side units (wei→mutez for XTZ; identity for ERC20). */
export const fromEvm = (amount: bigint, address: EvmAddress): bigint => (isXtz(address) ? xtzWeiToMutez(amount) : amount);
