// threeroute.ts — typed client for the 3route aggregator (1inch-v6.1 API shape) on Tezos X.
// Two read endpoints, both direction-agnostic (ERC20/XTZ -> ERC20/XTZ, exact-in or exact-out):
//   getQuote — pricing only (srcAmount/dstAmount), for rate display / previews.
//   getSwap  — pricing + ready router calldata + the guaranteed minimum output.
// The client is address-agnostic: native XTZ is just an address (see XTZ_ADDRESS in swap.ts). Auth (hosted
// server) is HTTP Basic with the api key; the local dev server needs none, so apiKey is optional.
import type { EvmAddress, Hex } from './address.js';

export interface ThreeRouteToken {
  readonly address: EvmAddress;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
}

// /quote — no calldata. One side is your input, the other is the quote (which is which depends on exactOut).
export interface QuoteResponse {
  srcAmount: string; // input base units  (strict when exactOut=false)
  dstAmount: string; // output base units (strict when exactOut=true)
}

export interface SwapTx {
  from: EvmAddress;
  to: EvmAddress; // 3route router
  data: Hex; // ready calldata (exact-input shape: param0=amountIn=srcAmount, param1=amountOutMin)
  value: string; // wei msg.value — nonzero exactly when src is native XTZ
  gas: string;
  gasPrice: string;
}

// /swap — a quote plus the on-chain pieces.
export interface SwapResponse extends QuoteResponse {
  dstAmountMin: string; // guaranteed minimum output, baked into the calldata as amountOutMin
  tx: SwapTx;
}

export interface SwapQuery {
  src: EvmAddress; // input token  (XTZ_ADDRESS for native XTZ)
  dst: EvmAddress; // output token (XTZ_ADDRESS for native XTZ)
  amount: bigint; // base units of the exact side (src when exact-in, dst when exact-out)
  exactOut?: boolean; // false = exact-input (default); true = exact-output
  slippagePercent?: number; // server-side slippage in percent; default 1
  from?: EvmAddress; // payer / msg.sender (the alias) — required by getSwap, optional for a bare quote
  receiver?: EvmAddress; // output recipient (the alias) — required by getSwap, optional for a bare quote
}

export interface ThreeRouteClientOptions {
  baseUrl: string; // '' to hit a same-origin proxy (browser/CORS); otherwise the server origin
  chainId: number;
  apiKey?: string; // HTTP Basic credential; omit for the local dev server
}

export class ThreeRouteClient {
  constructor(private readonly opts: ThreeRouteClientOptions) {}

  async getTokens(): Promise<ThreeRouteToken[]> {
    const { tokens } = await this.request<{ tokens: Record<string, ThreeRouteToken> }>('tokens');
    return Object.values(tokens);
  }

  // Pricing only, no calldata. Cheap enough to poll for live rates.
  getQuote(query: SwapQuery): Promise<QuoteResponse> {
    return this.request<QuoteResponse>(`quote?${this.queryString(query)}`);
  }

  // Pricing + ready router calldata + guaranteed minimum output. `from`/`receiver` must be set.
  getSwap(query: SwapQuery): Promise<SwapResponse> {
    return this.request<SwapResponse>(`swap?${this.queryString(query)}`);
  }

  private queryString(q: SwapQuery): string {
    const p = new URLSearchParams({
      src: q.src,
      dst: q.dst,
      amount: q.amount.toString(),
      slippage: String(q.slippagePercent ?? 1),
      isExactOutput: String(q.exactOut ?? false),
    });
    if (q.from) p.set('from', q.from);
    if (q.receiver) p.set('receiver', q.receiver);
    return p.toString();
  }

  private async request<T>(path: string): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.opts.apiKey) headers.Authorization = `Basic ${this.opts.apiKey}`;
    const res = await fetch(`${this.opts.baseUrl}/api/v6.1/${this.opts.chainId}/${path}`, { method: 'GET', headers });
    if (!res.ok) throw new Error(`3route ${path.split('?')[0]} -> HTTP ${res.status}`);
    return res.json() as Promise<T>;
  }
}
