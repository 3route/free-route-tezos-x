import type { MichelsonAddress } from './address.js';

export interface TezosXNetwork {
  name: string;
  chainId: number;
  gateway: MichelsonAddress; // Michelson→EVM call_evm gateway
  apiBaseUrl?: string; // default 3route endpoint; override per deployment (proxy/hosted)
}

export const tezosXPreviewnet: TezosXNetwork = {
  name: 'Tezos X Previewnet',
  chainId: 128064,
  gateway: 'KT18oDJJKXMKhfE1bSuAPGp92pYcwVDiqsPw',
  apiBaseUrl: 'http://127.0.0.1:3000',
};

// TODO(mainnet): previewnet placeholders — update chainId/gateway/apiBaseUrl when Tezos X mainnet ships.
export const tezosXMainnet: TezosXNetwork = {
  name: 'Tezos X Mainnet',
  chainId: 128064,
  gateway: 'KT18oDJJKXMKhfE1bSuAPGp92pYcwVDiqsPw',
};
