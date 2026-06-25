import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XTZ, isXtz, toEvmUnits, fromEvmUnits, xtzMutezToWei, xtzWeiToMutez } from '../../core/units.js';

const USDC = '0x39fD36e60A839DE4cB5DaE0E1009c0aa612Bfba1';
const WEI_PER_MUTEZ = 1_000_000_000_000n; // 1e12

test('mutez -> wei is exact; the mutez round-trip is lossless', () => {
  assert.equal(xtzMutezToWei(1n), WEI_PER_MUTEZ);
  assert.equal(xtzMutezToWei(4000n), 4000n * WEI_PER_MUTEZ);
  assert.equal(xtzWeiToMutez(xtzMutezToWei(123_456n)), 123_456n);
});

test('wei -> mutez floors (a guaranteed wei floor never rounds up past it)', () => {
  assert.equal(xtzWeiToMutez(WEI_PER_MUTEZ), 1n);
  assert.equal(xtzWeiToMutez(2n * WEI_PER_MUTEZ - 1n), 1n); // 1.999… mutez -> 1
  assert.equal(xtzWeiToMutez(WEI_PER_MUTEZ - 1n), 0n); // just under 1 mutez -> 0
});

test('isXtz is true only for the native (zero) address', () => {
  assert.equal(isXtz(XTZ.address), true);
  assert.equal(isXtz(USDC), false);
});

test('toEvmUnits/fromEvmUnits convert XTZ (mutez<->wei) and pass ERC20 amounts through unchanged', () => {
  assert.equal(toEvmUnits(4000n, XTZ.address), 4000n * WEI_PER_MUTEZ);
  assert.equal(fromEvmUnits(4000n * WEI_PER_MUTEZ, XTZ.address), 4000n);
  assert.equal(toEvmUnits(250n, USDC), 250n); // ERC20: identity
  assert.equal(fromEvmUnits(250n, USDC), 250n); // ERC20: identity
});

test('XTZ token: native zero address, 6 decimals (the mutez view)', () => {
  assert.equal(XTZ.address, '0x0000000000000000000000000000000000000000');
  assert.equal(XTZ.decimals, 6);
});
