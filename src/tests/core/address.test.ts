import { test } from 'node:test';
import assert from 'node:assert/strict';
import { michelsonToEvmAlias, evmToMichelsonAlias, aliasOf, legacyMichelsonToEvmAlias } from '../../core/address.js';

const TZ1 = 'tz1QPS1T1g2eiLptTSG6qLTK1789Cwt1rH3e';
const TZ1_LEGACY_EVM_ALIAS = '0x8B02895450dE0ce6B44160A2D0f1B2C84198DFa3'; // pre-RFC-26051 keccak alias
const TZ4 = 'tz496ZTpnyexrZQvHht4WunLS6JE366ePSwN';
const KT1 = 'KT1AyJ5P4qRJZuHqXiR9QkKRuCy49yNyLVzo';
const EVM_CHECKSUMMED = '0x39fD36e60A839DE4cB5DaE0E1009c0aa612Bfba1';
const EVM_WRONG_CHECKSUM = '0x39FD36e60A839DE4cB5DaE0E1009c0aa612Bfba1'; // valid hex, invalid EIP-55 casing
const EVM_ADDR = '0x926b76d9e0873647c82411728eaafde466595604';
const EVM_KT1_ALIAS = 'KT1U2kJNu6ZjiEsMCFRYSWPJ7GVzK4qfF5Gn';

// Recoverable-alias vectors (RFC-26051): artifacts/frozen.json of trilitech/tz-alias-recovery @ b42336e,
// the same table the kernel's `recoverable_alias` unit test pins.
const RECOVERABLE_VECTORS: [string, string][] = [
  ['tz1aygVpocoeEMU89vXk92sMHqPYFNZVgvrh', '0x0ea7865238580e0d8f0d2ca196d3b672dea705ad'],
  ['tz1WDRuEornRTSHFTgnwC5LPRQThxbZqofiF', '0x1975f732fea2a37de36e40017b907d6562ffce7d'],
  ['tz1cgbBXC99Tkv26pxXDcFExd5agYtJKp6Ko', '0xcd9737deee8444f5c277bee986586de00b5b5d2b'],
  ['tz1cEFKy9mT7yfTZX9yAGn4ZiFC77wxf5WC3', '0xf45fb97fc5d9785f1075bf86e050c608b601faaf'],
  ['tz2BCeQSi5ETyKJsob61pWCoQvoGtsrJBEt2', '0x29dd12971b4b7f5741334ab0cd72fe9706e2e2cd'],
  ['tz2DQNNCg1zbmNEMbYFK9sn1JakSkdkGy525', '0x3915cb0424fa0a7f08cf4f78aa9a6910177272b1'],
  ['tz2RteZE6H6r4YSX7PwHDiEodx1j365BS6Zw', '0x78cd291942fdd47a55cea942adbdc35782f1a254'],
  ['tz2Cv1duW3gb9j6yV4u3CzqkbrH2XYQuacu3', '0x3fdbb367414d2426d2549fa4f5429623d3c19c52'],
  ['tz3bqAfFRnSA6dfPRG8XR6MBMmo6HZTTG44V', '0xc75658fcee30564ffda5e61c48cdebd47eb0633e'],
  ['tz3UddKLx4bhUxev77uHWuy9UqDk1VHeDpfQ', '0x3ea387c764b0d48b8416e19a5d68d0219b9c13dd'],
  ['tz3bxdqRaqmfQ8V8aNPtJC3sg29GKMtAxSo4', '0xbc46edf18e7c5d62ae88c8796a490c491cccdda2'],
  ['tz3N5sNfWMwWLiUC65vH43rpHKDNYLGyrEnc', '0xee9440608815f399d8fd197cd5ead96dbcef288b'],
  ['tz1aAdmy1MiGhnRkw8RWS6xbUpTuSRh3ZB4y', '0xcdb4d002582717fa10060665ec598ac68590072a'],
  ['tz2K1exM7pLKyUtVTKqtDo6zFwv98trFxqBc', '0x40f2c21437e12669dbf98d5035b21c6141c7bb69'],
];

test('michelsonToEvmAlias: tz1/tz2/tz3 → recoverable CREATE2 alias (frozen vectors, EIP-55 checksummed)', () => {
  for (const [native, expected] of RECOVERABLE_VECTORS) {
    const alias = michelsonToEvmAlias(native);
    assert.equal(alias.toLowerCase(), expected, native);
    assert.notEqual(alias, alias.toLowerCase(), 'checksummed');
  }
});

test('michelsonToEvmAlias: KT1/tz4 keep the legacy keccak alias; tz1 no longer does', () => {
  assert.equal(michelsonToEvmAlias(KT1), legacyMichelsonToEvmAlias(KT1));
  assert.equal(michelsonToEvmAlias(TZ4), legacyMichelsonToEvmAlias(TZ4));
  assert.equal(legacyMichelsonToEvmAlias(TZ1), TZ1_LEGACY_EVM_ALIAS);
  assert.notEqual(michelsonToEvmAlias(TZ1), TZ1_LEGACY_EVM_ALIAS);
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
