import type { MichelsonAddress } from './primitives.js';

export interface TezosXNetwork {
  name: string;
  chainId: number;
  gateway: MichelsonAddress; // Michelson→EVM call_evm gateway
}

export const tezosXPreviewnet: TezosXNetwork = {
  name: 'Tezos X Previewnet',
  chainId: 128064,
  gateway: 'KT18oDJJKXMKhfE1bSuAPGp92pYcwVDiqsPw',
};

// TODO(mainnet): set the real Michelson→EVM gateway when Tezos X mainnet ships.
export const tezosXMainnet: TezosXNetwork = {
  name: 'Tezos X Mainnet',
  chainId: 42793,
  gateway: 'KT18oDJJKXMKhfE1bSuAPGp92pYcwVDiqsPw',
};
