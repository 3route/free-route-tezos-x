import { FreeRouteClient } from './free-route/index.js';
import type { Quote, QuoteQuery, Swap, SwapQuery, FreeRouteToken } from './free-route/index.js';
import type { FetchLike } from './http.js';
import type { EvmAddress, MichelsonAddress } from './primitives.js';
import { tezosXMainnet } from './networks.js';
import type { TezosXNetwork } from './networks.js';

export interface FreeRouteCoreOptions {
  baseUrl: string; // free-route API location
  apiKey: string; // free-route API key (required)
  network?: TezosXNetwork; // default tezosXMainnet
  fetch?: FetchLike; // default globalThis.fetch (inject for older Node, a custom agent, or tests)
}

/**
 * Shared base for every facade: free-route reads + both gateway addresses. Depends only on the core deps
 * (no @taquito/taquito, no @taquito/michel-codec) so it is safe to load from either side's entrypoint.
 */
export class FreeRouteCore {
  readonly client: FreeRouteClient;
  readonly michelsonGateway: MichelsonAddress; // Michelson→EVM (call_evm)
  readonly evmGateway: EvmAddress; // EVM→Michelson (callMichelson)

  constructor(opts: FreeRouteCoreOptions) {
    const network = opts.network ?? tezosXMainnet;
    this.client = new FreeRouteClient({ 
      baseUrl: opts.baseUrl, 
      chainId: network.chainId, 
      apiKey: opts.apiKey, 
      fetch: opts.fetch 
    });
    this.michelsonGateway = network.michelsonGateway;
    this.evmGateway = network.evmGateway;
  }

  getTokens(): Promise<readonly FreeRouteToken[]> {
    return this.client.getTokens();
  }
  getQuote(query: QuoteQuery): Promise<Quote> {
    return this.client.getQuote(query);
  }
  getSwap(query: SwapQuery): Promise<Swap> {
    return this.client.getSwap(query);
  }
}
