import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, isEvmAddress, getEvmAddress, encodeArgs, encodeCall, decodeUint256 } from '../evm.js';
import type { EvmAddress } from '../primitives.js';

const A = '0x1111111111111111111111111111111111111111' as EvmAddress;
const B = '0x2222222222222222222222222222222222222222' as EvmAddress;

test('keccak256 of a known string', () => {
  // keccak-256("") — standard test vector
  assert.equal(keccak256(''), '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
});

test('function selectors match the well-known ERC20 ones', () => {
  assert.equal(encodeCall('approve(address,uint256)', [A, 1n]).slice(0, 10), '0x095ea7b3');
  assert.equal(encodeCall('allowance(address,address)', [A, B]).slice(0, 10), '0xdd62ed3e');
  assert.equal(encodeCall('balanceOf(address)', [A]).slice(0, 10), '0x70a08231');
});

test('EIP-55 checksum (spec vector) + isEvmAddress', () => {
  assert.equal(getEvmAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'), '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
  assert.ok(isEvmAddress(A));
  assert.ok(!isEvmAddress('0x123')); // too short
  assert.throws(() => getEvmAddress('0xnothex'), /invalid EVM address/);
});

test('encodeArgs packs address + uint256 into two 32-byte words', () => {
  const out = encodeArgs('approve(address,uint256)', [A, 255n]);
  assert.equal(out.length, 2 + 128); // 0x + 2*64 hex
  assert.equal(out.slice(2, 66), '0'.repeat(24) + A.slice(2)); // address right-aligned, lowercased
  assert.equal(out.slice(66), '0'.repeat(62) + 'ff'); // 255
});

test('decodeUint256 round-trips a 32-byte word', () => {
  assert.equal(decodeUint256('0x' + '0'.repeat(62) + 'ff'), 255n);
  assert.equal(decodeUint256(encodeArgs('x(uint256)', [123456789n])), 123456789n);
});

test('uint256 out of range is rejected (negative / overflow)', () => {
  assert.doesNotThrow(() => encodeArgs('x(uint256)', [2n ** 256n - 1n])); // max is fine
  assert.throws(() => encodeArgs('x(uint256)', [-1n]), /uint256 out of range/);
  assert.throws(() => encodeArgs('x(uint256)', [2n ** 256n]), /uint256 out of range/);
});
