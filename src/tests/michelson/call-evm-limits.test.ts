import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callEvmGas, CALL_EVM_GAS_CAP } from '../../michelson/call-evm-limits.js';

const feeFor = (gasLimit: number) => 1000 + Math.ceil(gasLimit / 8);

test('fromEvmEstimate sizes gasLimit = 10000 + ceil(evmGas/48) with storage + gas-derived fee', () => {
  assert.deepEqual(callEvmGas.fromEvmEstimate(4_800_000n), { gasLimit: 110_000, storageLimit: 350, fee: feeFor(110_000) });
});

test('fromEvmEstimate adapts to route size (more EVM gas -> larger limit)', () => {
  assert.equal(callEvmGas.fromEvmEstimate(3_793_000n).gasLimit, 10_000 + Math.ceil(3_793_000 / 48)); // single-hop swap
  assert.equal(callEvmGas.fromEvmEstimate(6_521_000n).gasLimit, 10_000 + Math.ceil(6_521_000 / 48)); // 5-pool split
});

test('fromEvmEstimate keeps ~10x headroom over the measured need and stays far below the op ceiling', () => {
  // measured under proto 025: a 6.52M-EVM-gas split swap needs ~13.6k declared Michelson gas
  const g = callEvmGas.fromEvmEstimate(6_521_000n).gasLimit;
  assert.ok(g >= 13_600 * 8 && g < CALL_EVM_GAS_CAP, `got ${g}`);
});

test('fromEvmEstimate clamps an anomalous estimate to the cap, which itself sits under the 660k op limit', () => {
  assert.equal(callEvmGas.fromEvmEstimate(100_000_000n).gasLimit, CALL_EVM_GAS_CAP);
  assert.ok(CALL_EVM_GAS_CAP < 660_000);
});

test('fromEvmEstimate falls back to a safe default when the estimate is missing (<=0)', () => {
  assert.equal(callEvmGas.fromEvmEstimate(0n).gasLimit, 100_000);
});

test('fixed completes a known gasLimit with storage + matching fee', () => {
  assert.deepEqual(callEvmGas.fixed(12_000), { gasLimit: 12_000, storageLimit: 350, fee: feeFor(12_000) });
});
