import type { ParamsWithKind } from '@taquito/taquito';
import { ThreeRouteClient } from './threeroute/index.js';
import type { Quote, QuoteQuery, Swap, SwapQuery, ThreeRouteToken } from './threeroute/index.js';
import type { FetchLike } from './http.js';
import type { MichelsonAddress } from './primitives.js';
import * as ops from './operations/index.js';
import type { BuildCallEvmOptions, BuildErc20ApproveOptions, BuildSwapOperationOptions } from './operations/index.js';
import { tezosXMainnet } from './networks.js';
import type { TezosXNetwork } from './networks.js';

export interface ThreeRouteTezosXOptions {
  baseUrl: string; // 3route API location
  apiKey?: string; // 3route API key
  network?: TezosXNetwork; // Default tezosXMainnet
  fetch?: FetchLike; // default globalThis.fetch (inject for older Node, a custom agent, or tests)
}

/** Tezos X facade: the 3route client + gateway; delegates reads and builds ops with the gateway injected. */
export class ThreeRouteTezosX {
  readonly client: ThreeRouteClient;
  readonly gateway: MichelsonAddress;

  constructor(opts: ThreeRouteTezosXOptions) {
    const network = opts.network ?? tezosXMainnet;
    this.client = new ThreeRouteClient({ 
      baseUrl: opts.baseUrl, 
      chainId: network.chainId, 
      apiKey: opts.apiKey, 
      fetch: opts.fetch 
    });
    this.gateway = network.gateway;
  }

  // ── 3route reads (delegate to the client) ──
  getTokens(): Promise<readonly ThreeRouteToken[]> {
    return this.client.getTokens();
  }
  getQuote(query: QuoteQuery): Promise<Quote> {
    return this.client.getQuote(query);
  }
  getSwap(query: SwapQuery): Promise<Swap> {
    return this.client.getSwap(query);
  }

  // ── op builders ──
  buildSwapOperation(o: Omit<BuildSwapOperationOptions, 'gateway'>): ParamsWithKind[] {
    return ops.buildSwapOperation({ ...o, gateway: this.gateway });
  }
  buildErc20Approve(o: Omit<BuildErc20ApproveOptions, 'gateway'>): ParamsWithKind {
    return ops.buildErc20Approve({ ...o, gateway: this.gateway });
  }
  buildCallEvm(o: Omit<BuildCallEvmOptions, 'gateway'>): ParamsWithKind {
    return ops.buildCallEvm({ ...o, gateway: this.gateway });
  }
}
