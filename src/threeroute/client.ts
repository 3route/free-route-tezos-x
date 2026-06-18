import type { EvmAddress } from '../primitives.js';
import { requestJson, type FetchLike } from '../http.js';
import type { Quote, Swap, ThreeRouteToken } from './models.js';
import { parseQuote, parseSwap } from './dto.js';
import type { QuoteResponseDto, SwapResponseDto } from './dto.js';

/** Pricing query (getQuote). No from/receiver — per rust-3route QuoteRequest. */
export interface QuoteQuery {
  src: EvmAddress; // XTZ_ADDRESS for native XTZ
  dst: EvmAddress;
  amount: bigint; // base units of the exact side (dst when exactOut)
  exactOut?: boolean; // default false (exact-input)
  slippagePercent?: number; // default 1
}

/** Swap query (getSwap). Per rust-3route SwapRequest: `from` required, `receiver` optional (defaults to `from`). */
export interface SwapQuery extends QuoteQuery {
  from: EvmAddress;
  receiver?: EvmAddress;
}

export interface ThreeRouteClientOptions {
  baseUrl: string;
  chainId: number;
  apiKey?: string;
  timeoutMs?: number;
  fetch?: FetchLike; // default globalThis.fetch
}

export function authHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Basic ${apiKey}` } : {};
}

export interface ThreeRouteApi {
  getTokens(): Promise<readonly ThreeRouteToken[]>;
  getQuote(query: QuoteQuery): Promise<Quote>;
  getSwap(query: SwapQuery): Promise<Swap>;
}

export class ThreeRouteClient implements ThreeRouteApi {
  constructor(private readonly opts: ThreeRouteClientOptions) {}

  async getTokens(): Promise<readonly ThreeRouteToken[]> {
    const { tokens } = await this.request<{ tokens: Record<string, ThreeRouteToken> }>('tokens');
    return Object.values(tokens);
  }

  /** Pricing only, no calldata. */
  async getQuote(query: QuoteQuery): Promise<Quote> {
    return parseQuote(await this.request<QuoteResponseDto>(`quote?${this.queryString(query)}`));
  }

  /** Pricing + router calldata + guaranteed minimum output. */
  async getSwap(query: SwapQuery): Promise<Swap> {
    return parseSwap(await this.request<SwapResponseDto>(`swap?${this.queryString(query)}`));
  }

  // Optional params sent only when set — the server owns the defaults (slippage=1, exact-input).
  private queryString(q: QuoteQuery & { from?: EvmAddress; receiver?: EvmAddress }): string {
    const p = new URLSearchParams({ src: q.src, dst: q.dst, amount: q.amount.toString() });
    if (q.exactOut !== undefined) p.set('isExactOutput', String(q.exactOut));
    if (q.slippagePercent !== undefined) p.set('slippage', String(q.slippagePercent));
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
