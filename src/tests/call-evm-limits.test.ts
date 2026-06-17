import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callEvmGas } from '../call-evm-limits.js';

const feeFor = (gasLimit: number) => 1000 + Math.ceil(gasLimit / 8);

test('fromEvmEstimate sizes gasLimit = 20000 + ceil(evmGas/10) with storage + gas-derived fee', () => {
  assert.deepEqual(callEvmGas.fromEvmEstimate(604_000n), { gasLimit: 80_400, storageLimit: 350, fee: feeFor(80_400) });
});

test('fromEvmEstimate adapts to route size (more EVM gas -> larger limit)', () => {
  assert.equal(callEvmGas.fromEvmEstimate(304_000n).gasLimit, 50_400);
  assert.equal(callEvmGas.fromEvmEstimate(904_000n).gasLimit, 110_400);
});

test('fromEvmEstimate clamps an anomalous estimate to the cap', () => {
  assert.equal(callEvmGas.fromEvmEstimate(100_000_000n).gasLimit, 1_500_000);
});

test('fromEvmEstimate falls back to a safe default when the estimate is missing (<=0)', () => {
  assert.equal(callEvmGas.fromEvmEstimate(0n).gasLimit, 500_000);
});

test('fixed completes a known gasLimit with storage + matching fee', () => {
  assert.deepEqual(callEvmGas.fixed(12_000), { gasLimit: 12_000, storageLimit: 350, fee: feeFor(12_000) });
});
