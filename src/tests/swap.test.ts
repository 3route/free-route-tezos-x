import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpKind } from '@taquito/taquito';
import type { ParamsWithKind } from '@taquito/taquito';
import type { Swap } from '../free-route/index.js';
import { buildSwapOperation } from '../operations/swap.js';
import { callEvmGas } from '../call-evm-limits.js';
import { decodeUint256 } from '../evm.js';
import { XTZ } from '../units.js';

type Tx = Extract<ParamsWithKind, { kind: OpKind.TRANSACTION }>; // the transaction variant buildSwapOperation emits

const GATEWAY = 'KT18oDJJKXMKhfE1bSuAPGp92pYcwVDiqsPw';
const ROUTER = '0x25896fd23d41c1d9F8779afc0D8AA3f52ca743Dc';
const USDC = '0x39fD36e60A839DE4cB5DaE0E1009c0aa612Bfba1';
const erc20Opts = { gateway: GATEWAY, srcAddress: USDC };

// minimal Swap; data has a 4-byte selector so .slice(10) yields valid bytes
const swapWith = (evmGas: bigint, srcAmount = 100n, value = 0n): Swap => ({
  srcAmount,
  dstAmount: 4000n,
  dstAmountMin: 3900n,
  tx: { from: ROUTER, to: ROUTER, data: '0xdeadbeefcafe', value, gas: evmGas, gasPrice: 1n },
});

// call_evm value is Pair(dest, sig, calldata-bytes, None) (right-comb); Micheline is a deep union, so walk it loosely
const mich = (op: Tx): any => op.parameter!.value;
const sigOf = (op: Tx): string => mich(op).args[1].args[0].string;
const isApprove = (op: Tx) => sigOf(op) === 'approve(address,uint256)';
const isSwap = (op: Tx) => sigOf(op).startsWith('swap(');
// approve calldata is encodeArgs(address,uint256) = two 32-byte words; the amount is the 2nd (hex chars 64..128)
const approveAmount = (op: Tx): bigint => decodeUint256('0x' + mich(op).args[1].args[1].args[0].bytes.slice(64));
const limitsOf = (op: Tx) => ({ gasLimit: op.gasLimit, storageLimit: op.storageLimit, fee: op.fee });

test("approval 'none' -> [swap] only; an ERC20 input forwards no XTZ value", () => {
  // non-zero tx.value must be ignored for an ERC20 input (value is only for native XTZ)
  const ops = buildSwapOperation({ swap: swapWith(604_000n, 100n, 5_000_000_000_000_000_000n), ...erc20Opts, approval: 'none' });
  assert.equal(ops.length, 1);
  const [swap] = ops as [Tx];
  assert.ok(isSwap(swap));
  assert.equal(swap.amount, 0);
});

test("approval 'approve' -> [approve(srcAmount), swap]", () => {
  const ops = buildSwapOperation({ swap: swapWith(604_000n, 250n), ...erc20Opts, approval: 'approve' });
  assert.equal(ops.length, 2);
  const [approve, swap] = ops as [Tx, Tx];
  assert.ok(isApprove(approve) && isSwap(swap));
  assert.equal(approveAmount(approve), 250n);
});

test("approval 'resetThenApprove' (default) -> [reset(0), approve(srcAmount), swap]", () => {
  const ops = buildSwapOperation({ swap: swapWith(604_000n, 250n), ...erc20Opts }); // default mode
  assert.equal(ops.length, 3);
  const [reset, approve, swap] = ops as [Tx, Tx, Tx];
  assert.ok(isApprove(reset) && isApprove(approve) && isSwap(swap));
  assert.equal(approveAmount(reset), 0n); // reset first
  assert.equal(approveAmount(approve), 250n); // then approve the amount the swap pulls
});

test('native-XTZ swap -> [swap] only (no approve) with value forwarded as mutez', () => {
  const ops = buildSwapOperation({ swap: swapWith(304_000n, 100n, 5_000_000_000_000_000_000n), gateway: GATEWAY, srcAddress: XTZ.address });
  assert.equal(ops.length, 1);
  const [swap] = ops as [Tx];
  assert.equal(swap.amount, 5_000_000); // 5 XTZ wei -> mutez
  assert.equal(swap.mutez, true);
});

test('swap op carries callEvmGas.fromEvmEstimate(tx.gas); opts.limits overrides', () => {
  const [def] = buildSwapOperation({ swap: swapWith(604_000n), ...erc20Opts, approval: 'none' }) as [Tx];
  assert.deepEqual(limitsOf(def), callEvmGas.fromEvmEstimate(604_000n));

  const override = callEvmGas.fixed(42_000);
  const [ovr] = buildSwapOperation({ swap: swapWith(604_000n), ...erc20Opts, approval: 'none', limits: override }) as [Tx];
  assert.deepEqual(limitsOf(ovr), override);
});
