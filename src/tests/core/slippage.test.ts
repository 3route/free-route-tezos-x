import { test } from 'node:test';
import assert from 'node:assert/strict';
import { targetForMinOut } from '../../core/slippage.js';

// the on-chain floor the server guarantees for an exact-out target, in the same units
const floor = (target: bigint, bps: number) => (target * BigInt(10_000 - bps)) / 10_000n;

test('grosses up minOut by slippage (worked example: 4000 @ 2% -> 4082)', () => {
  assert.equal(targetForMinOut(4000n, 200), 4082n);
});

test('returns the MINIMAL target whose post-slippage floor still covers minOut', () => {
  const minOut = 4000n;
  const bps = 200;
  const t = targetForMinOut(minOut, bps);
  assert.ok(floor(t, bps) >= minOut); // floor covers the minimum
  assert.ok(floor(t - 1n, bps) < minOut); // one mutez less would not — so t is minimal
});

test('zero slippage is identity', () => {
  assert.equal(targetForMinOut(4000n, 0), 4000n);
  assert.equal(targetForMinOut(1n, 0), 1n);
});

test('rounds up (ceil), and the floor invariant holds across sizes/rates', () => {
  assert.equal(targetForMinOut(1000n, 100), 1011n); // 1000 / 0.99 = 1010.1 -> 1011
  for (const [m, bps] of [[1n, 50], [12_345n, 300], [10n ** 18n, 250]] as [bigint, number][]) {
    assert.ok(floor(targetForMinOut(m, bps), bps) >= m);
  }
});

test('rejects out-of-range / non-integer slippageBps (server contract 0..5000)', () => {
  for (const bad of [5001, 10_000, -1, 1.5, NaN]) {
    assert.throws(() => targetForMinOut(4000n, bad), RangeError);
  }
  assert.doesNotThrow(() => targetForMinOut(4000n, 5000)); // the max (50%) is valid
});
