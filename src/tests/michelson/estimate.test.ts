import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Estimate, ParamsWithKind } from '@taquito/taquito';
import {
  estimateMichelsonOperation, buildCallEvmOperation, objkt, tezosXPreviewnet,
  CALL_EVM_ESTIMATE_MARGIN, CALL_EVM_GAS_CAP, CALL_EVM_STORAGE_LIMIT,
} from '../../michelson/index.js';
import type { TezosEstimator } from '../../michelson/index.js';
import type { Hex, OpLimits } from '../../core/primitives.js';

// The helper reads three fields of Taquito's Estimate plus the node's fee rates; a toolkit stub records what it
// was asked to simulate. Fee rates as previewnet reports them: 45 nanotez/gas (0.045 µtz), 4000 nanotez/byte.
type Est = Pick<Estimate, 'gasLimit' | 'storageLimit' | 'suggestedFeeMutez'>;
const est = (gasLimit: number, suggestedFeeMutez: number, storageLimit = 0): Est => ({ gasLimit, storageLimit, suggestedFeeMutez });
const MEMPOOL_FILTER = { minimal_fees: '100', minimal_nanotez_per_gas_unit: ['45', '1'], minimal_nanotez_per_byte: ['4000', '1'] };
const FEE_PER_GAS = 0.045;
const feeFor = (e: Est, gasLimit: number) => Math.ceil(e.suggestedFeeMutez + (gasLimit - e.gasLimit) * FEE_PER_GAS);
const toolkit = (estimates: Est[], seen: ParamsWithKind[][] = []): TezosEstimator =>
  ({
    estimate: { batch: async (ops: ParamsWithKind[]) => { seen.push(ops); return estimates; } },
    rpc: { getMempoolFilter: async () => MEMPOOL_FILTER },
  }) as unknown as TezosEstimator;

// Real builder output as fixtures — what production callers feed in.
const ROUTER = '0x1872E760f142b2bFb74C8aC315A80C91067F17FE';
const MARKETPLACE = 'KT1SkZH5zTjzcAeYvu874zHNmEDEcCVbUEx1'; // objkt v4 clone on previewnet
const callEvm = (michelsonGateway = tezosXPreviewnet.michelsonGateway) =>
  buildCallEvmOperation({ michelsonGateway, dest: ROUTER, sig: 'approve(address,uint256)', abiargs: `0x${'00'.repeat(64)}` as Hex });
const fulfill = () => objkt.buildMichelsonFulfillAskOperation({ marketplace: MARKETPLACE, askId: '1', editions: 1, amountMutez: 4_000n });
const limitsOf = ({ gasLimit, storageLimit, fee }: ParamsWithKind & Partial<OpLimits>) => ({ gasLimit, storageLimit, fee });

test('call_evm ops get estimate × margin (fee scaled, storage floored); pure-Michelson ops keep the node estimate', async () => {
  const swapEst = est(10_875, 5_500); // ~1.1 KB of calldata at 4 µtz/byte dominates the suggested fee
  const readyOps = await estimateMichelsonOperation({ tezos: toolkit([swapEst, est(9_982, 1_200, 100)]), ops: [callEvm(), fulfill()] });
  assert.equal(readyOps.length, 2);
  assert.deepEqual(limitsOf(readyOps[0]!), { gasLimit: 21_750, storageLimit: CALL_EVM_STORAGE_LIMIT, fee: feeFor(swapEst, 21_750) });
  assert.equal(limitsOf(readyOps[0]!).fee, 5_500 + Math.ceil(10_875 * 0.045)); // added gas at the node's rate — not a doubled 11 000
  assert.deepEqual(limitsOf(readyOps[1]!), { gasLimit: 9_982, storageLimit: 100, fee: 1_200 });
  assert.equal(CALL_EVM_ESTIMATE_MARGIN, 2);
});

test('detects call_evm by entrypoint, whatever gateway address the op was built against', async () => {
  const other = 'KT1NLW24kq4dKjCjY3xy4C7g3qedKeCkTzuB';
  const readyOps = await estimateMichelsonOperation({ tezos: toolkit([est(10_000, 1_000)]), ops: [callEvm(other)] });
  assert.equal(limitsOf(readyOps[0]!).gasLimit, 20_000);
});

test('simulates UNPINNED: the builder pin is stripped before the estimate call, and the input is not mutated', async () => {
  const seen: ParamsWithKind[][] = [];
  const pinned = { ...callEvm(), gasLimit: 145_855, storageLimit: 350, fee: 19_232 } as ParamsWithKind;
  await estimateMichelsonOperation({ tezos: toolkit([est(10_875, 1_300)], seen), ops: [pinned] });
  assert.deepEqual(limitsOf(seen[0]![0]!), { gasLimit: undefined, storageLimit: undefined, fee: undefined });
  assert.deepEqual(limitsOf(pinned), { gasLimit: 145_855, storageLimit: 350, fee: 19_232 });
});

test('custom margin; a call_evm estimate above the cap throws instead of sizing below the estimate', async () => {
  const readyOps = await estimateMichelsonOperation({ tezos: toolkit([est(10_000, 1_000)]), ops: [callEvm()], margin: 3 });
  assert.equal(limitsOf(readyOps[0]!).gasLimit, 30_000);
  assert.equal(limitsOf(readyOps[0]!).fee, 1_000 + 20_000 * FEE_PER_GAS);
  await assert.rejects(
    estimateMichelsonOperation({ tezos: toolkit([est(CALL_EVM_GAS_CAP + 1, 61_000)]), ops: [callEvm()] }),
    /above the 600000 cap/,
  );
  const cappedEst = est(400_000, 41_000);
  const capped = await estimateMichelsonOperation({ tezos: toolkit([cappedEst]), ops: [callEvm()] });
  assert.equal(limitsOf(capped[0]!).gasLimit, CALL_EVM_GAS_CAP); // 800k → 600k, fee for the capped gas only
  assert.equal(limitsOf(capped[0]!).fee, feeFor(cappedEst, CALL_EVM_GAS_CAP));
});

test('an unrevealed source: exactly one leading reveal estimate is skipped; any other count mismatch throws', async () => {
  const readyOps = await estimateMichelsonOperation({ tezos: toolkit([est(1_000, 400) /* reveal */, est(10_000, 1_000), est(5_000, 700)]), ops: [callEvm(), fulfill()] });
  assert.equal(limitsOf(readyOps[0]!).gasLimit, 20_000);
  assert.equal(limitsOf(readyOps[1]!).gasLimit, 5_000);
  await assert.rejects(estimateMichelsonOperation({ tezos: toolkit([est(1, 1)]), ops: [callEvm(), fulfill()] }), /returned 1 entries for 2 ops/);
  await assert.rejects(estimateMichelsonOperation({ tezos: toolkit([est(1, 1), est(1, 1), est(1, 1)]), ops: [callEvm()] }), /returned 3 entries for 1 ops/);
});

test('an empty group is returned as is, without touching the node', async () => {
  const seen: ParamsWithKind[][] = [];
  assert.deepEqual(await estimateMichelsonOperation({ tezos: toolkit([], seen), ops: [] }), []);
  assert.equal(seen.length, 0);
});

test('a failing simulation propagates (a revert is a real error, not a sizing problem)', async () => {
  const failing = { ...toolkit([]), estimate: { batch: async () => { throw new Error('(permanent) tezlink_error'); } } } as unknown as TezosEstimator;
  await assert.rejects(estimateMichelsonOperation({ tezos: failing, ops: [callEvm()] }), /tezlink_error/);
});
