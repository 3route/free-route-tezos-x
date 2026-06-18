import type { EvmAddress } from '../primitives.js';
import { requestJson, type FetchLike } from '../http.js';
import type { Quote, Swap, FreeRouteToken } from './models.js';
import { parseQuote, parseSwap } from './dto.js';
import type { QuoteResponseDto, SwapResponseDto } from './dto.js';
import { assertSlippageBps } from '../slippage.js';

/** Pricing query (getQuote). No from/receiver/slippage — per rust-free-route QuoteRequest. */
export interface QuoteQuery {
  src: EvmAddress; // XTZ_ADDRESS for native XTZ
  dst: EvmAddress;
  amount: bigint; // base units of the exact side (dst when isExactOut)
  isExactOut?: boolean; // default false (exact-input)
}

/** Swap query (getSwap). Per rust-free-route SwapRequest: `from` required, `receiver`/`slippage` optional. */
export interface SwapQuery extends QuoteQuery {
  from: EvmAddress;
  receiver?: EvmAddress;
  // Slippage tolerance in basis points (1 bps = 0.01%; 50 = 0.5%). Integer, 0..MAX_SLIPPAGE_BPS (0%..50%).
  slippageBps?: number;
}

export interface FreeRouteClientOptions {
  baseUrl: string;
  chainId: number;
  apiKey?: string;
  timeoutMs?: number;
  fetch?: FetchLike; // default globalThis.fetch
}

export function authHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Basic ${apiKey}` } : {};
}

export interface FreeRouteApi {
  getTokens(): Promise<readonly FreeRouteToken[]>;
  getQuote(query: QuoteQuery): Promise<Quote>;
  getSwap(query: SwapQuery): Promise<Swap>;
}

export class FreeRouteClient implements FreeRouteApi {
  constructor(private readonly opts: FreeRouteClientOptions) {}

  async getTokens(): Promise<readonly FreeRouteToken[]> {
    const { tokens } = await this.request<{ tokens: Record<string, FreeRouteToken> }>('tokens');
    return Object.values(tokens);
  }

  /** Pricing only, no calldata. */
  async getQuote(query: QuoteQuery): Promise<Quote> {
    return parseQuote(await this.request<QuoteResponseDto>(`quote?${this.queryString(query)}`));
  }

  /** Pricing + router calldata + guaranteed minimum output. */
  async getSwap(query: SwapQuery): Promise<Swap> {
    if (query.slippageBps !== undefined) assertSlippageBps(query.slippageBps);
    return parseSwap(await this.request<SwapResponseDto>(`swap?${this.queryString(query)}`));
  }

  // Optional params sent only when set — the server owns the defaults (slippage=1%, exact-input).
  private queryString(q: QuoteQuery & { from?: EvmAddress; receiver?: EvmAddress; slippageBps?: number }): string {
    const p = new URLSearchParams({ src: q.src, dst: q.dst, amount: q.amount.toString() });
    if (q.isExactOut !== undefined) p.set('isExactOutput', String(q.isExactOut));
    // The server's `slippage` is a percent (f64); we expose bps. getSwap already asserted an integer bps,
    // so bps/100 is exact and the server's `(percent*100) as u64` recovers the same bps targetForMinOut used.
    if (q.slippageBps !== undefined) p.set('slippage', String(q.slippageBps / 100));
    if (q.from) p.set('from', q.from);
    if (q.receiver) p.set('receiver', q.receiver);
    return p.toString();
  }

  private request<T>(path: string): Promise<T> {
    return requestJson<T>(`${this.opts.baseUrl}/api/v6.1/${this.opts.chainId}/${path}`, {
      headers: { 'Content-Type': 'application/json', ...authHeaders(this.opts.apiKey) },
      timeoutMs: this.opts.timeoutMs,
      fetch: this.opts.fetch,
    });
  }
}
