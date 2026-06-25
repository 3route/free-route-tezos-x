import { test } from 'node:test';
import assert from 'node:assert/strict';
import { michelsonToEvmAlias, evmToMichelsonAlias, aliasOf } from '../../core/address.js';

const TZ1 = 'tz1QPS1T1g2eiLptTSG6qLTK1789Cwt1rH3e';
const TZ1_EVM_ALIAS = '0x8B02895450dE0ce6B44160A2D0f1B2C84198DFa3';
const TZ4 = 'tz496ZTpnyexrZQvHht4WunLS6JE366ePSwN';
const KT1 = 'KT1AyJ5P4qRJZuHqXiR9QkKRuCy49yNyLVzo';
const EVM_CHECKSUMMED = '0x39fD36e60A839DE4cB5DaE0E1009c0aa612Bfba1';
const EVM_WRONG_CHECKSUM = '0x39FD36e60A839DE4cB5DaE0E1009c0aa612Bfba1'; // valid hex, invalid EIP-55 casing
const EVM_ADDR = '0x926b76d9e0873647c82411728eaafde466595604';
const EVM_KT1_ALIAS = 'KT1U2kJNu6ZjiEsMCFRYSWPJ7GVzK4qfF5Gn';

test('michelsonToEvmAlias: known tz1 → its EVM alias (EIP-55 checksummed)', () => {
  assert.equal(michelsonToEvmAlias(TZ1), TZ1_EVM_ALIAS);
});

test('evmToMichelsonAlias: EVM → KT1 alias (BLAKE2b), case-insensitive input', () => {
  assert.equal(evmToMichelsonAlias(EVM_ADDR), EVM_KT1_ALIAS);
  assert.equal(evmToMichelsonAlias(EVM_ADDR.toUpperCase().replace('0X', '0x')), EVM_KT1_ALIAS);
});

test('evmToMichelsonAlias: rejects non-EVM input', () => {
  assert.throws(() => evmToMichelsonAlias(TZ1));
  assert.throws(() => evmToMichelsonAlias(EVM_WRONG_CHECKSUM));
});

test('aliasOf: bidirectional — Michelson → EVM alias, EVM → Michelson KT1 alias', () => {
  assert.equal(aliasOf(TZ1), michelsonToEvmAlias(TZ1));
  assert.equal(aliasOf(TZ4), michelsonToEvmAlias(TZ4));
  assert.equal(aliasOf(KT1), michelsonToEvmAlias(KT1));
  assert.equal(aliasOf(EVM_ADDR), EVM_KT1_ALIAS);
  assert.equal(aliasOf(EVM_CHECKSUMMED), evmToMichelsonAlias(EVM_CHECKSUMMED));
});

test('aliasOf: rejects malformed input instead of yielding a bogus alias', () => {
  assert.throws(() => aliasOf('tz4Foo')); // bad/short tz4
  assert.throws(() => aliasOf('tz1QPS1T1g2eiLptTSG6qLTK1789Cwt1rH3X')); // valid prefix, wrong checksum
  assert.throws(() => aliasOf('garbage'));
  assert.throws(() => aliasOf('0x1234')); // not a 20-byte EVM address
  assert.throws(() => aliasOf(EVM_WRONG_CHECKSUM)); // wrong EIP-55 → neither valid EVM nor Michelson
});
