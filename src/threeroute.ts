// Typed client for the 3route aggregator (1inch-v6.1 API shape) on Tezos X. Two direction-agnostic read
// endpoints (ERC20/XTZ → ERC20/XTZ, exact-in or -out): getQuote (pricing only) and getSwap (pricing + router
// calldata + guaranteed min out). Native XTZ is just an address (XTZ_ADDRESS, see swap.ts).
import type { EvmAddress, Hex } from './address.js';

export interface ThreeRouteToken {
  readonly address: EvmAddress;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
}

// Wire DTOs — what /quote and /swap return; amounts are decimal strings (JSON can't carry bigint).
export interface QuoteResponseDto {
  srcAmount: string;
  dstAmount: string;
}
export interface SwapTxDto {
  from: EvmAddress;
  to: EvmAddress; // 3route router
  data: Hex; // router calldata
  value: string; // wei msg.value — nonzero only for native-XTZ input
  gas: string;
  gasPrice: string;
}
export interface SwapResponseDto extends QuoteResponseDto {
  dstAmountMin: string; // guaranteed minimum output
  tx: SwapTxDto;
}

// Domain models — amounts parsed to bigint (like ethers/viem); calldata/addresses stay strings.
export interface Quote {
  srcAmount: bigint;
  dstAmount: bigint;
}
export interface SwapTx {
  from: EvmAddress;
  to: EvmAddress;
  data: Hex;
  value: bigint;
  gas: bigint;
  gasPrice: bigint;
}
export interface Swap {
  srcAmount: bigint;
  dstAmount: bigint;
  dstAmountMin: bigint;
  tx: SwapTx;
}

// DTO ↔ model codecs. Bidirectional so a proxy can parse the upstream DTO then re-serialize for its own JSON hop.
/** Parse a wire {@link QuoteResponseDto} into a {@link Quote} (bigint amounts). */
export const parseQuote = (d: QuoteResponseDto): Quote => ({
  srcAmount: BigInt(d.srcAmount),
  dstAmount: BigInt(d.dstAmount),
});
/** Serialize a {@link Quote} back to its wire DTO (decimal strings). */
export const serializeQuote = (q: Quote): QuoteResponseDto => ({
  srcAmount: q.srcAmount.toString(),
  dstAmount: q.dstAmount.toString(),
});
const parseTx = (d: SwapTxDto): SwapTx => ({
  from: d.from,
  to: d.to,
  data: d.data,
  value: BigInt(d.value),
  gas: BigInt(d.gas),
  gasPrice: BigInt(d.gasPrice),
});
const serializeTx = (t: SwapTx): SwapTxDto => ({
  from: t.from,
  to: t.to,
  data: t.data,
  value: t.value.toString(),
  gas: t.gas.toString(),
  gasPrice: t.gasPrice.toString(),
});
/** Parse a wire {@link SwapResponseDto} into a {@link Swap} (bigint amounts; calldata/addresses unchanged). */
export const parseSwap = (d: SwapResponseDto): Swap => ({
  srcAmount: BigInt(d.srcAmount),
  dstAmount: BigInt(d.dstAmount),
  dstAmountMin: BigInt(d.dstAmountMin),
  tx: parseTx(d.tx),
});
/** Serialize a {@link Swap} back to its wire DTO (decimal strings). */
export const serializeSwap = (s: Swap): SwapResponseDto => ({
  srcAmount: s.srcAmount.toString(),
  dstAmount: s.dstAmount.toString(),
  dstAmountMin: s.dstAmountMin.toString(),
  tx: serializeTx(s.tx),
});

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
  baseUrl: string; // '' to hit a same-origin proxy (browser/CORS); otherwise the server origin
  chainId: number;
  /** HTTP Basic credential — the ENCODED token (base64("user:pass")), sent after "Basic ". Server-side only;
   *  never set on a browser client. Omit for a keyless server. */
  apiKey?: string;
}

/** Build the 3route auth header. Kept in one place so the client and any proxy can't drift on the scheme. */
export function authHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Basic ${apiKey}` } : {};
}

/** The 3route read surface as an interface — implemented by the keyed {@link ThreeRouteClient} and any BFF shim. */
export interface ThreeRouteApi {
  getTokens(): Promise<ThreeRouteToken[]>;
  getQuote(query: QuoteQuery): Promise<Quote>;
  getSwap(query: SwapQuery): Promise<Swap>;
}

export class ThreeRouteClient implements ThreeRouteApi {
  constructor(private readonly opts: ThreeRouteClientOptions) {}

  /** The token registry. */
  async getTokens(): Promise<ThreeRouteToken[]> {
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
  private queryString(q: QuoteQuery & Partial<Pick<SwapQuery, 'from' | 'receiver'>>): string {
    const p = new URLSearchParams({ src: q.src, dst: q.dst, amount: q.amount.toString() });
    if (q.exactOut !== undefined) p.set('isExactOutput', String(q.exactOut));
    if (q.slippagePercent !== undefined) p.set('slippage', String(q.slippagePercent));
    if (q.from) p.set('from', q.from);
    if (q.receiver) p.set('receiver', q.receiver);
    return p.toString();
  }

  private async request<T>(path: string): Promise<T> {
    const headers = { 'Content-Type': 'application/json', ...authHeaders(this.opts.apiKey) };
    const res = await fetch(`${this.opts.baseUrl}/api/v6.1/${this.opts.chainId}/${path}`, { method: 'GET', headers });
    if (!res.ok) throw new Error(`3route ${path.split('?')[0]} -> HTTP ${res.status}`);
    return res.json() as Promise<T>;
  }
}
