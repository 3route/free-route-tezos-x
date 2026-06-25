import type { EvmAddress, MichelsonAddress } from './primitives.js';

// Protocol-enshrined cross-runtime gateways — the same address on every Tezos X network.
// EVM→Michelson: an EVM precompile (callMichelson entrypoint).
export const EVM_GATEWAY: EvmAddress = '0xff00000000000000000000000000000000000007';
// Michelson→EVM: an enshrined Michelson contract (call_evm entrypoint).
export const MICHELSON_GATEWAY: MichelsonAddress = 'KT18oDJJKXMKhfE1bSuAPGp92pYcwVDiqsPw';

export interface TezosXNetwork {
  name: string;
  chainId: number;
  michelsonGateway: MichelsonAddress; // Michelson→EVM call_evm gateway
  evmGateway: EvmAddress; // EVM→Michelson callMichelson gateway
}

export const tezosXPreviewnet: TezosXNetwork = {
  name: 'Tezos X Previewnet',
  chainId: 128064,
  michelsonGateway: MICHELSON_GATEWAY,
  evmGateway: EVM_GATEWAY,
};

export const tezosXMainnet: TezosXNetwork = {
  name: 'Tezos X Mainnet',
  chainId: 42793,
  michelsonGateway: MICHELSON_GATEWAY,
  evmGateway: EVM_GATEWAY,
};
