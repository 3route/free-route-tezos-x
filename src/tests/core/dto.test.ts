import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeQuote, parseQuote, serializeSwap, parseSwap,
  serializeQuoteQuery, parseQuoteQuery, serializeSwapQuery, parseSwapQuery,
} from '../../index.js';
import type { Quote, QuoteQuery, Swap, SwapQuery } from '../../index.js';
import type { EvmAddress, Hex } from '../../index.js';

const USDC = '0x39fd36e60a839de4cb5dae0e1009c0aa612bfba1' as EvmAddress; // lowercase -> valid
const XTZ = '0x0000000000000000000000000000000000000000' as EvmAddress;
const USER = '0x211a87956d4df778a7730ee3058fab5429321af8' as EvmAddress;
const BAD_CHECKSUM = '0x39FD36e60A839DE4cB5DaE0E1009c0aa612Bfba1'; // valid hex, wrong EIP-55 casing

// ── query codec round-trips (request side) ──
test('quote query: serialize -> parse round-trips (incl. bigint amount + isExactOut)', () => {
  const q: QuoteQuery = { src: USDC, dst: XTZ, amount: 1_000_000n, isExactOut: true };
  assert.deepEqual(parseQuoteQuery(serializeQuoteQuery(q)), q);
});

test('quote query without isExactOut round-trips (field omitted)', () => {
  const q: QuoteQuery = { src: USDC, dst: XTZ, amount: 42n };
  assert.deepEqual(parseQuoteQuery(serializeQuoteQuery(q)), q);
});

test('swap query: serialize -> parse round-trips (from / receiver / slippageBps)', () => {
  const q: SwapQuery = { src: USDC, dst: XTZ, amount: 1_000_000n, isExactOut: true, from: USER, receiver: USER, slippageBps: 200 };
  assert.deepEqual(parseSwapQuery(serializeSwapQuery(q)), q);
});

// ── query parse validates untrusted params (throws) ──
const params = (o: Record<string, string>) => new URLSearchParams(o);

test('parseQuoteQuery throws on missing/bad src, dst, amount', () => {
  assert.throws(() => parseQuoteQuery(params({ dst: XTZ, amount: '1' }))); // no src
  assert.throws(() => parseQuoteQuery(params({ src: 'nope', dst: XTZ, amount: '1' }))); // bad src
  assert.throws(() => parseQuoteQuery(params({ src: USDC, dst: XTZ, amount: '-1' }))); // negative
  assert.throws(() => parseQuoteQuery(params({ src: USDC, dst: XTZ, amount: '1.5' }))); // non-integer
});

test('parseQuoteQuery throws on a non-boolean isExactOut', () => {
  assert.throws(() => parseQuoteQuery(params({ src: USDC, dst: XTZ, amount: '1', isExactOut: 'maybe' })));
});

test('parseSwapQuery requires from', () => {
  assert.throws(() => parseSwapQuery(params({ src: USDC, dst: XTZ, amount: '1' }))); // no from
});

test('address validation is case-insensitive (accepts any casing, stored as-is — the server need not checksum)', () => {
  const q = parseQuoteQuery(params({ src: BAD_CHECKSUM, dst: XTZ, amount: '1' }));
  assert.equal(q.src, BAD_CHECKSUM); // mixed-case accepted and preserved, not rejected/normalized
});

test('address validation still rejects non-hex / wrong length', () => {
  assert.throws(() => parseQuoteQuery(params({ src: '0x1234', dst: XTZ, amount: '1' }))); // too short
  assert.throws(() => parseQuoteQuery(params({ src: '0x' + 'z'.repeat(40), dst: XTZ, amount: '1' }))); // non-hex
});

// ── response codec round-trips (response side, bigint preserved) ──
test('quote response: serialize -> parse round-trips', () => {
  const quote: Quote = { srcAmount: 123n, dstAmount: 456n };
  assert.deepEqual(parseQuote(serializeQuote(quote)), quote);
});

test('swap response: serialize -> parse round-trips (incl. tx bigints)', () => {
  const swap: Swap = {
    srcAmount: 123n,
    dstAmount: 456n,
    dstAmountMin: 400n,
    tx: { from: USER, to: USDC, data: '0xdeadbeef' as Hex, value: 5n, gas: 21_000n, gasPrice: 1n },
  };
  assert.deepEqual(parseSwap(serializeSwap(swap)), swap);
});
