// Typed client for the rust-3route 1inch-compatible aggregator API.
// DTO shapes mirror rust-3route/3route/src/server/models.rs (camelCase serde) verbatim.
// Endpoints: GET /api/v6.1/{chain}/{tokens, tokens/{address}, swap}.
import type { EvmAddress, Hex, Quote } from './types.js';

// 1inch native-token sentinel. Pass as `dst` to receive NATIVE XTZ from the swap:
// the server maps it to address(0) and the router pays native to `receiver`.
export const NATIVE_XTZ: EvmAddress = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

// --- response DTOs (server/models.rs) ---
export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string | null;
  domainVersion?: string | null;
  eip2612?: boolean | null;
  isFoT?: boolean | null;
  tags?: string[] | null;
}

export interface TokensResponse {
  tokens: Record<string, TokenInfo>; // keyed by token address
}

export interface TransactionData {
  from: string;
  to: EvmAddress; // router
  data: Hex; // ABI-encoded swap calldata (0x-prefixed)
  value: string; // wei; "0" for ERC20 input
  gas: string;
  gasPrice: string;
}

export interface SwapResponse {
  dstAmount: string; // swap output (>= target in exact-out)
  srcAmount: string; // what the caller pays incl. referrer fee — our amountIn
  srcToken?: TokenInfo;
  dstToken?: TokenInfo;
  protocols?: unknown;
  gas?: number;
  blockNumber?: number;
  tx: TransactionData; // ready-to-run swap
}

// --- request params for GET /swap ---
export interface SwapParams {
  src: EvmAddress; // input token
  dst: EvmAddress; // output token (NATIVE_XTZ for native)
  amount: bigint | string; // exact-out: target output; exact-in: input
  from: EvmAddress; // tx.from (the contract that calls the router)
  slippage?: number; // percent 0..50 (server default 1)
  receiver?: EvmAddress; // output recipient (server defaults to `from`)
  isExactOutput?: boolean;
  includeTokensInfo?: boolean;
  includeProtocols?: boolean;
  includeGas?: boolean;
}

// --- client config ---
export interface ThreeRouteClient {
  baseUrl: string; // e.g. "http://localhost:8080"
  chainId: number; // e.g. 128064 (Tezos X previewnet)
  fetch?: typeof fetch; // injectable for tests
}

const trimSlash = (s: string): string => s.replace(/\/+$/, '');

async function apiGet<T>(client: ThreeRouteClient, path: string, query?: Record<string, string>): Promise<T> {
  const doFetch = client.fetch ?? fetch;
  const qs = query && Object.keys(query).length ? `?${new URLSearchParams(query).toString()}` : '';
  const url = `${trimSlash(client.baseUrl)}/api/v6.1/${client.chainId}/${path}${qs}`;
  const res = await doFetch(url);
  if (!res.ok) {
    const body = await res.text();
    let detail = body;
    try {
      const parsed = JSON.parse(body) as { description?: string; error?: string };
      detail = parsed.description ?? parsed.error ?? body;
    } catch {
      /* non-JSON error body — keep it raw */
    }
    throw new Error(`3route ${res.status} ${path}: ${detail}`);
  }
  return (await res.json()) as T;
}

// --- endpoints ---
export const getTokens = (client: ThreeRouteClient): Promise<TokensResponse> =>
  apiGet<TokensResponse>(client, 'tokens');

export const getSwap = (client: ThreeRouteClient, params: SwapParams): Promise<SwapResponse> =>
  apiGet<SwapResponse>(client, 'swap', swapQuery(params));

function swapQuery(p: SwapParams): Record<string, string> {
  const q: Record<string, string> = { src: p.src, dst: p.dst, amount: String(p.amount), from: p.from };
  if (p.slippage !== undefined) q.slippage = String(p.slippage);
  if (p.receiver !== undefined) q.receiver = p.receiver;
  if (p.isExactOutput) q.isExactOutput = 'true';
  if (p.includeTokensInfo) q.includeTokensInfo = 'true';
  if (p.includeProtocols) q.includeProtocols = 'true';
  if (p.includeGas) q.includeGas = 'true';
  return q;
}

// --- registry helpers (token availability) ---
export const tokenList = (r: TokensResponse): TokenInfo[] => Object.values(r.tokens);

/** Find a token by address or symbol (case-insensitive). */
export function findToken(r: TokensResponse, key: EvmAddress | string): TokenInfo | undefined {
  const needle = key.toLowerCase();
  return tokenList(r).find((t) => t.address.toLowerCase() === needle || t.symbol.toLowerCase() === needle);
}

/** Assert a token is in the registry; returns its info or throws a clear error. */
export function assertSupported(r: TokensResponse, key: EvmAddress | string, label: string = key): TokenInfo {
  const token = findToken(r, key);
  if (!token) {
    throw new Error(`token ${label} is not in the 3route registry (${tokenList(r).length} tokens) — pick a supported pay token`);
  }
  return token;
}

// --- response -> Quote (parse the /swap tx into what SwapBridge consumes) ---
export function swapResponseToQuote(resp: SwapResponse, opts: { tokenIn: EvmAddress; minXtzOut: bigint }): Quote {
  return {
    tokenIn: opts.tokenIn,
    amountIn: BigInt(resp.srcAmount),
    minXtzOut: opts.minXtzOut,
    router: resp.tx.to,
    swapCalldata: resp.tx.data,
  };
}
