import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSwapOperation, buildErc20Approve, XTZ } from '../index.js';
import type { Swap } from '../threeroute.js';

const GATEWAY = 'KT18oDJJKXMKhfE1bSuAPGp92pYcwVDiqsPw';
const ROUTER = '0x25896fd23d41c1d9F8779afc0D8AA3f52ca743Dc';
const USDC = '0x39fD36e60A839DE4cB5DaE0E1009c0aa612Bfba1';

// minimal Swap with a controllable tx.gas; data has a 4-byte selector so .slice(10) yields valid bytes
const swapWith = (evmGas: bigint, value = 0n): Swap => ({
  srcAmount: 100n,
  dstAmount: 4000n,
  dstAmountMin: 3900n,
  tx: { from: ROUTER, to: ROUTER, data: '0xdeadbeefcafe', value, gas: evmGas, gasPrice: 1n },
});

const opOf = (op: any) => ({ gasLimit: op.gasLimit, storageLimit: op.storageLimit, fee: op.fee });

test('swap op gas is derived from tx.gas (20000 + ceil(gas/10)) with a gas-scaled fee', () => {
  const [swapOp] = buildSwapOperation(swapWith(604_000n), { gateway: GATEWAY, srcAddress: USDC, approval: 'none' });
  assert.deepEqual(opOf(swapOp), { gasLimit: 80_400, storageLimit: 350, fee: 1000 + Math.ceil(80_400 / 8) });
});

test('swap gas adapts to route size (more EVM gas -> larger limit)', () => {
  const [small] = buildSwapOperation(swapWith(304_000n), { gateway: GATEWAY, srcAddress: USDC, approval: 'none' });
  const [big] = buildSwapOperation(swapWith(904_000n), { gateway: GATEWAY, srcAddress: USDC, approval: 'none' });
  assert.equal((small as any).gasLimit, 50_400);
  assert.equal((big as any).gasLimit, 110_400);
});

test('swap gas is clamped for an anomalous tx.gas', () => {
  const [op] = buildSwapOperation(swapWith(100_000_000n), { gateway: GATEWAY, srcAddress: USDC, approval: 'none' });
  assert.equal((op as any).gasLimit, 1_500_000); // SWAP_GAS_CAP
});

test('native-XTZ swap forwards value as msg.value and still sizes gas from tx.gas', () => {
  const [op] = buildSwapOperation(swapWith(304_000n, 5_000_000_000_000_000_000n), { gateway: GATEWAY, srcAddress: XTZ.address });
  assert.equal((op as any).amount, 5_000_000); // 5 XTZ wei -> mutez
  assert.equal((op as any).mutez, true);
  assert.equal((op as any).gasLimit, 50_400);
});

test('approve is pinned to its own small gas with a matching fee', () => {
  const approve = buildErc20Approve(GATEWAY, USDC, ROUTER, 1000n) as any;
  assert.deepEqual(opOf(approve), { gasLimit: 12_000, storageLimit: 350, fee: 1000 + Math.ceil(12_000 / 8) });
});
