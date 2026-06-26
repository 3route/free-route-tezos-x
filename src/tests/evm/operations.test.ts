import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvmApproveTransaction, buildCallMichelsonTransaction, buildEvmSwapTransaction, encodeCallMichelson, forgeMichelson, EVM_GATEWAY } from '../../index.js';
import { buildEvmFulfillAskTransaction } from '../../objkt/evm.js';
import type { Swap } from '../../core/free-route/index.js';
import type { EvmAddress, Hex } from '../../core/primitives.js';

// Golden bytes are locked to the recipe validated on-chain by the EVM-native spikes:
// forged Micheline (packDataBytes, 0x05 PACK tag stripped) + ABI callMichelson(string,string,bytes),
// XTZ value forwarded as wei (mutez ×1e12). These regression-lock that recipe.

const USDC: EvmAddress = '0x39fD36e60A839DE4cB5DaE0E1009c0aa612Bfba1';
const ROUTER: EvmAddress = '0x0000000000000000000000000000000000000001';

test('buildEvmApproveTransaction: approve(address,uint256) — selector 0x095ea7b3, padded args, value 0', () => {
  const tx = buildEvmApproveTransaction({ token: USDC, spender: ROUTER, amount: 1000n });
  assert.equal(tx.to, USDC);
  assert.equal(tx.value, 0n);
  assert.equal(
    tx.data,
    '0x095ea7b3' +
      '0000000000000000000000000000000000000000000000000000000000000001' + // spender
      '00000000000000000000000000000000000000000000000000000000000003e8', // 1000
  );
});

test('encodeCallMichelson: selector + 3 dynamic args (string,string,bytes), round-trips', () => {
  const data = encodeCallMichelson('KT1', 'ep', '0x00');
  assert.equal(data.slice(0, 10), '0xa1544fc3'); // keccak256("callMichelson(string,string,bytes)")[:4]
  const body = data.slice(10);
  // head = three offset words (0x60); each arg = len word + data padded to 32 ("KT1","ep","0x00" all ≤32B → 1 word)
  assert.equal(BigInt('0x' + body.slice(0, 64)), 0x60n);
  assert.equal(BigInt('0x' + body.slice(64, 128)), 0xa0n); // 0x60 + 0x40 (dest: len + 1 word)
  assert.equal(BigInt('0x' + body.slice(128, 192)), 0xe0n); // 0xa0 + 0x40 (entrypoint: len + 1 word)
});

test('forgeMichelson: strips the 0x05 PACK tag (forged value only)', () => {
  // a nat: forged form is 00 ++ leb128; packed would prefix 0x05
  const forged = forgeMichelson({ int: '42' }, { prim: 'nat' });
  assert.equal(forged, '0x002a');
  assert.ok(!forged.startsWith('0x05'));
});

test('buildCallMichelsonTransaction: targets the EVM→Michelson gateway and forwards mutez as wei', () => {
  const tx = buildCallMichelsonTransaction({ destination: 'KT1', entrypoint: 'ep', data: '0x00' as Hex, valueMutez: 1_500_000n, evmGateway: EVM_GATEWAY });
  assert.equal(tx.to, EVM_GATEWAY);
  assert.equal(tx.value, 1_500_000_000_000_000_000n); // 1.5 XTZ in wei
  assert.equal(tx.data, encodeCallMichelson('KT1', 'ep', '0x00'));
});

test('buildCallMichelsonTransaction: respects a custom gateway and defaults value to 0', () => {
  const tx = buildCallMichelsonTransaction({ destination: 'KT1', entrypoint: 'ep', data: '0x00' as Hex, evmGateway: ROUTER });
  assert.equal(tx.to, ROUTER);
  assert.equal(tx.value, 0n);
});

test('buildEvmFulfillAskTransaction: golden tx (gateway, value, callMichelson(fulfill_ask) data)', () => {
  const tx = buildEvmFulfillAskTransaction({
    marketplace: 'KT1Mqx5meQbdw8gFa9JK9ozzKnYAvHbpFwTm',
    askId: 42n,
    editions: 1,
    amountMutez: 1_500_000n,
  });
  assert.equal(tx.to, EVM_GATEWAY); // defaults to the EVM→Michelson gateway precompile
  assert.equal(tx.value, 1_500_000_000_000_000_000n);
  assert.equal(
    tx.data,
    '0xa1544fc3' +
      '0000000000000000000000000000000000000000000000000000000000000060' +
      '00000000000000000000000000000000000000000000000000000000000000c0' +
      '0000000000000000000000000000000000000000000000000000000000000100' +
      '0000000000000000000000000000000000000000000000000000000000000024' +
      '4b54314d7178356d655162647738674661394a4b396f7a7a4b6e5941764862704677546d00000000000000000000000000000000000000000000000000000000' +
      '000000000000000000000000000000000000000000000000000000000000000b' +
      '66756c66696c6c5f61736b000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000015' +
      '0707002a07070001070703060707030602000000000000000000000000000000',
  );
});

test('buildEvmFulfillAskTransaction: evmGateway override targets the given gateway', () => {
  const tx = buildEvmFulfillAskTransaction({ marketplace: 'KT1Mqx5meQbdw8gFa9JK9ozzKnYAvHbpFwTm', askId: 42n, editions: 1, amountMutez: 1_500_000n, evmGateway: ROUTER });
  assert.equal(tx.to, ROUTER);
});

// minimal Swap fixture (only the fields the EVM builders read)
const swapFixture = (srcAmount: bigint, value = 0n): Swap => ({
  srcAmount,
  dstAmount: 0n,
  dstAmountMin: 0n,
  tx: { from: ROUTER, to: ROUTER, data: '0xdeadbeef' as Hex, value, gas: 0n, gasPrice: 0n },
});

const ZERO: EvmAddress = '0x0000000000000000000000000000000000000000'; // native XTZ

test('buildEvmSwapTransaction: native XTZ → the swap tx alone, passing through to/data/value (no approve)', () => {
  const txs = buildEvmSwapTransaction({ swap: swapFixture(0n, 5_000_000_000_000_000_000n), srcAddress: ZERO });
  assert.equal(txs.length, 1);
  assert.deepEqual(txs[0], { to: ROUTER, data: '0xdeadbeef', value: 5_000_000_000_000_000_000n }); // msg.value carries the XTZ
});

test('buildEvmSwapTransaction: ERC20 resetThenApprove (default) → [reset, approve, swap]', () => {
  const txs = buildEvmSwapTransaction({ swap: swapFixture(500n), srcAddress: USDC });
  assert.equal(txs.length, 3);
  assert.equal(txs[0]!.to, USDC); // reset allowance to 0
  assert.equal(txs[0]!.data, buildEvmApproveTransaction({ token: USDC, spender: ROUTER, amount: 0n }).data);
  assert.equal(txs[1]!.data, buildEvmApproveTransaction({ token: USDC, spender: ROUTER, amount: 500n }).data);
  assert.equal(txs[2]!.data, '0xdeadbeef'); // swap
});

test('buildEvmSwapTransaction: ERC20 approve mode → [approve, swap]; none → [swap]', () => {
  assert.equal(buildEvmSwapTransaction({ swap: swapFixture(500n), srcAddress: USDC, approval: 'approve' }).length, 2);
  assert.equal(buildEvmSwapTransaction({ swap: swapFixture(500n), srcAddress: USDC, approval: 'none' }).length, 1);
});
