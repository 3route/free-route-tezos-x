import { test } from 'node:test';
import assert from 'node:assert/strict';
import { michelsonToAlias, aliasOf } from '../address.js';

const TZ1 = 'tz1QPS1T1g2eiLptTSG6qLTK1789Cwt1rH3e';
const TZ1_ALIAS = '0x8B02895450dE0ce6B44160A2D0f1B2C84198DFa3';
const TZ4 = 'tz496ZTpnyexrZQvHht4WunLS6JE366ePSwN'; // BLS implicit — the prefix the old regex missed
const KT1 = 'KT1AyJ5P4qRJZuHqXiR9QkKRuCy49yNyLVzo';
const EVM_LOWER = '0x39fd36e60a839de4cb5dae0e1009c0aa612bfba1';
const EVM_CHECKSUMMED = '0x39fD36e60A839DE4cB5DaE0E1009c0aa612Bfba1';
const EVM_WRONG_CHECKSUM = '0x39FD36e60A839DE4cB5DaE0E1009c0aa612Bfba1'; // valid hex, invalid EIP-55 casing

test('michelsonToAlias: known tz1 → its EVM alias (EIP-55 checksummed)', () => {
  assert.equal(michelsonToAlias(TZ1), TZ1_ALIAS);
});

test('michelsonToAlias: deterministic and distinct per address', () => {
  assert.equal(michelsonToAlias(TZ1), michelsonToAlias(TZ1));
  assert.notEqual(michelsonToAlias(TZ1), michelsonToAlias(KT1));
});

test('aliasOf: EVM address → itself, checksummed (lowercase is accepted, checksummed output)', () => {
  assert.equal(aliasOf(EVM_LOWER), EVM_CHECKSUMMED);
  assert.equal(aliasOf(EVM_CHECKSUMMED), EVM_CHECKSUMMED);
});

test('aliasOf: EVM address with a wrong EIP-55 checksum throws (not accepted)', () => {
  assert.throws(() => aliasOf(EVM_WRONG_CHECKSUM));
});

test('aliasOf: valid Michelson address → its alias (tz1, tz4 BLS, KT1)', () => {
  assert.equal(aliasOf(TZ1), michelsonToAlias(TZ1));
  assert.equal(aliasOf(TZ4), michelsonToAlias(TZ4));
  assert.equal(aliasOf(KT1), michelsonToAlias(KT1));
});

test('aliasOf: rejects malformed input instead of yielding a bogus alias', () => {
  assert.throws(() => aliasOf('tz4Foo')); // bad/short tz4
  assert.throws(() => aliasOf('tz1QPS1T1g2eiLptTSG6qLTK1789Cwt1rH3X')); // valid prefix, wrong checksum
  assert.throws(() => aliasOf('garbage'));
  assert.throws(() => aliasOf('0x1234')); // not a 20-byte EVM address
});
