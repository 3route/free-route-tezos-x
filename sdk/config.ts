// Network/contract config for the SDK core (Tezos X previewnet). Minimal by design — only what the
// swap+bridge builders need: the Michelson->EVM gateway, the SwapBridge contract, and the per-block gas cap.
// Token / marketplace / RPC choices belong to the consumer, not the SDK.
import type { NetworkConfig, OpDefaults } from './types.js';

export const PREVIEWNET: NetworkConfig = {
  gatewayTez: 'KT18oDJJKXMKhfE1bSuAPGp92pYcwVDiqsPw', // Michelson->EVM gateway (%call_evm)
  swapBridge: '0x26181Fb297472a6a9fdAf9e5Ed9FFd75821d91a4', // hardened SwapBridge (SafeERC20+ReentrancyGuard+refund); slither-clean
  maxOpGas: 3_000_000, // hard_gas_limit_per_operation == per_block
};

// Pinned per-op limits for the call_evm ops. NOT estimated: on previewnet Taquito's auto-fee undershoots the
// node floor AND a call_evm op needs an explicit gasLimit to back the cross-runtime EVM execution. Overridable.
export const DEFAULTS: OpDefaults = { callEvmGas: 300_000, fee: 100_000, storageLimit: 2_000 };
