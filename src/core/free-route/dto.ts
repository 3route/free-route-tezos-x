import type { EvmAddress, Hex } from '../primitives.js';
import { isEvmAddress } from '../evm.js';
import type { Quote, Swap, SwapTx } from './models.js';
import type { QuoteQuery, SwapQuery } from './client.js';

export interface QuoteResponseDto {
  readonly srcAmount: string;
  readonly dstAmount: string;
}

export interface SwapTxDto {
  readonly from: EvmAddress;
  readonly to: EvmAddress; // free-route router
  readonly data: Hex; // router calldata
  readonly value: string; // wei msg.value — nonzero only for native-XTZ input
  readonly gas: string;
  readonly gasPrice: string;
}

export interface SwapResponseDto extends QuoteResponseDto {
  readonly dstAmountMin: string; // guaranteed minimum output
  readonly tx: SwapTxDto;
}

export const parseQuote = (d: QuoteResponseDto): Quote => ({
  srcAmount: BigInt(d.srcAmount),
  dstAmount: BigInt(d.dstAmount),
});

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

export const parseSwap = (d: SwapResponseDto): Swap => ({
  srcAmount: BigInt(d.srcAmount),
  dstAmount: BigInt(d.dstAmount),
  dstAmountMin: BigInt(d.dstAmountMin),
  tx: parseTx(d.tx),
});

export const serializeSwap = (s: Swap): SwapResponseDto => ({
  srcAmount: s.srcAmount.toString(),
  dstAmount: s.dstAmount.toString(),
  dstAmountMin: s.dstAmountMin.toString(),
  tx: serializeTx(s.tx),
});

// ── query codec for your own proxy boundary (BFF) — round-trips a QuoteQuery/SwapQuery through URL params,
//    using the SDK's own field names. Mirror of serialize*/parse* above, for the request side. (This is NOT
//    the upstream free-route wire format — FreeRouteClient owns that internally.)
// Case-insensitive structural check (reuses core/evm via lowercasing) — accept any casing the server sends;
// the address is stored as-is. Addresses are machine-supplied here, so we don't enforce the EIP-55 checksum.
const isAddr = (s: string | null): s is EvmAddress => s !== null && isEvmAddress(s.toLowerCase());

/** Serialize a QuoteQuery to URL params (round-trips with parseQuoteQuery). */
export const serializeQuoteQuery = (q: QuoteQuery): URLSearchParams => {
  const p = new URLSearchParams({ src: q.src, dst: q.dst, amount: q.amount.toString() });
  if (q.isExactOut !== undefined) p.set('isExactOut', String(q.isExactOut));
  return p;
};

/** Serialize a SwapQuery to URL params (QuoteQuery fields + from / receiver / slippageBps). */
export const serializeSwapQuery = (q: SwapQuery): URLSearchParams => {
  const p = serializeQuoteQuery(q);
  p.set('from', q.from);
  if (q.receiver !== undefined) p.set('receiver', q.receiver);
  if (q.slippageBps !== undefined) p.set('slippageBps', String(q.slippageBps));
  return p;
};

/** Parse + structurally validate untrusted QuoteQuery params (throws on malformed). Slippage range is left to getSwap. */
export const parseQuoteQuery = (params: URLSearchParams): QuoteQuery => {
  const src = params.get('src');
  const dst = params.get('dst');
  const amount = params.get('amount');
  if (!isAddr(src)) throw new Error('bad or missing `src` (expected a 0x address)');
  if (!isAddr(dst)) throw new Error('bad or missing `dst` (expected a 0x address)');
  if (!amount || !/^\d+$/.test(amount)) throw new Error('bad or missing `amount` (expected a non-negative integer)');
  const q: QuoteQuery = { src, dst, amount: BigInt(amount) };
  const isExactOut = params.get('isExactOut');
  if (isExactOut !== null) {
    if (isExactOut !== 'true' && isExactOut !== 'false') throw new Error('`isExactOut` must be "true" or "false"');
    q.isExactOut = isExactOut === 'true';
  }
  return q;
};

/** Parse + validate untrusted SwapQuery params (requires `from`; receiver/slippageBps optional). */
export const parseSwapQuery = (params: URLSearchParams): SwapQuery => {
  const from = params.get('from');
  if (!isAddr(from)) throw new Error('bad or missing `from` (required for a swap, expected a 0x address)');
  const swap: SwapQuery = { ...parseQuoteQuery(params), from };
  const receiver = params.get('receiver');
  if (receiver !== null) {
    if (!isAddr(receiver)) throw new Error('`receiver` must be a 0x address');
    swap.receiver = receiver;
  }
  const slippage = params.get('slippageBps'); // only parsed; getSwap owns the range/integer contract
  if (slippage) swap.slippageBps = Number(slippage);
  return swap;
};
