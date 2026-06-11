// networks.ts — Tezos X network presets for the swap SDK: the chain constants the SDK and the 3route server
// agree on (chainId + the Michelson->EVM gateway), plus an optional default 3route API endpoint. Transport
// concerns (apiKey, or a different baseUrl such as a same-origin proxy) stay separate — pass them to
// ThreeRouteTezosX. Marketplace addresses are NOT here (see marketplaces/objkt.ts) — the swap SDK is
// marketplace-agnostic.
import type { MichelsonAddress } from './address.js';

export interface TezosXNetwork {
  name: string;
  chainId: number;
  gateway: MichelsonAddress; // Michelson->EVM call_evm gateway
  apiBaseUrl?: string; // default 3route API location for this network; override per deployment (proxy, hosted)
}

export const tezosXPreviewnet: TezosXNetwork = {
  name: 'Tezos X Previewnet',
  chainId: 128064,
  gateway: 'KT18oDJJKXMKhfE1bSuAPGp92pYcwVDiqsPw',
  apiBaseUrl: 'http://127.0.0.1:3000', // local rust-3route dev server
};

// TODO(mainnet): Tezos X mainnet is not live yet — these are PREVIEWNET placeholders. Update chainId,
// gateway and apiBaseUrl when mainnet ships.
export const tezosXMainnet: TezosXNetwork = {
  name: 'Tezos X Mainnet',
  chainId: 128064, // TODO: real mainnet chainId
  gateway: 'KT18oDJJKXMKhfE1bSuAPGp92pYcwVDiqsPw', // TODO: real mainnet gateway
  // apiBaseUrl: TODO — hosted 3route endpoint (until then, pass baseUrl explicitly)
};
