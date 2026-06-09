// Shared types for the SDK core (universal ERC20 -> XTZ swap + bridge).
import type { TransferParams } from '@taquito/taquito';

// --- domain aliases ---
export type Tz1Address = string; // tz1.../tz2.../tz3...
export type EvmAddress = string; // 0x...
export type Hex = string; // 0x-prefixed hex string

// --- network / contracts (minimal — only what the swap+bridge builders need) ---
export interface NetworkConfig {
  gatewayTez: string; // Michelson->EVM gateway (%call_evm)
  swapBridge: string; // the swap+bridge helper contract
  maxOpGas: number; // hard_gas_limit_per_operation == per_block (batch Σ gasLimit guard)
}

// pinned per-op limits applied to the call_evm ops by the builders
export interface OpDefaults {
  callEvmGas: number;
  fee: number;
  storageLimit: number;
}

// --- swap quote (from rust-3route exact-out) ---
export interface Quote {
  tokenIn: EvmAddress;
  amountIn: bigint; // input token units — exact-out computed server-side
  minXtzOut: bigint; // wei (the XTZ floor the swap must clear)
  router: EvmAddress;
  swapCalldata: Hex; // route-agnostic swap calldata to run on `router`
}

// ABI arguments for SwapBridge.swapAndBridgePull
export interface SwapBridgeArgs {
  tokenIn: EvmAddress;
  amountIn: bigint;
  minXtzOut: bigint;
  recipientTz1: Tz1Address;
  router: EvmAddress;
  swapCalldata: Hex;
}

// Result of buildSwapBridgeBatch: the swap+bridge ops plus the allowance facts behind them.
// `ops` are UNTAGGED TransferParams ([reset?, approve?, swapAndBridgePull]); the consumer appends its own
// operation(s) and passes the combined list through buildBatchTransaction to tag + gas-guard the group.
export interface SwapBridgeBatch {
  ops: TransferParams[];
  alias: EvmAddress; // the buyer tz1's EVM alias (pays the input token)
  allowance: bigint; // current alias->SwapBridge allowance for the pay token
  approvePrepended: boolean; // a scoped approve was added (allowance was short)
  resetPrepended: boolean; // an approve(0) reset was added first (USDT-style guard over a non-zero allowance)
}
