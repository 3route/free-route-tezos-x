import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectApproval, readAllowance } from '../../core/approval.js';
import type { FetchLike } from '../../core/http.js';

const Q = {
  evmRpc: 'http://rpc.test',
  token: '0x39fD36e60A839DE4cB5DaE0E1009c0aa612Bfba1',
  owner: '0x8B02895450dE0ce6B44160A2D0f1B2C84198DFa3',
  spender: '0x25896fd23d41c1d9F8779afc0D8AA3f52ca743Dc',
};

// stub fetch: returns a canned JSON body (and ok/status) regardless of args
const mockFetch = (json: unknown, ok = true): FetchLike =>
  (async () => ({ ok, status: ok ? 200 : 500, json: async () => json })) as unknown as FetchLike;

test('selectApproval: minimal safe mode per allowance vs required', () => {
  assert.equal(selectApproval(100n, 50n), 'none'); // allowance > required
  assert.equal(selectApproval(50n, 50n), 'none'); // allowance == required
  assert.equal(selectApproval(0n, 50n), 'approve'); // fresh allowance
  assert.equal(selectApproval(10n, 50n), 'resetThenApprove'); // 0 < allowance < required (USDT-safe)
  assert.equal(selectApproval(0n, 0n), 'none'); // nothing to approve
});

test('readAllowance: decodes a uint256 eth_call result', async () => {
  const wire = '0x' + (1_000_000n).toString(16).padStart(64, '0');
  assert.equal(await readAllowance({ ...Q, fetch: mockFetch({ result: wire }) }), 1_000_000n);
});

test('readAllowance: throws on a JSON-RPC error', async () => {
  await assert.rejects(() => readAllowance({ ...Q, fetch: mockFetch({ error: { message: 'boom' } }) }), /boom/);
});

test('readAllowance: throws on empty 0x (token is not an ERC20)', async () => {
  await assert.rejects(() => readAllowance({ ...Q, fetch: mockFetch({ result: '0x' }) }), /ERC20/);
});

test('readAllowance: throws on a non-2xx response', async () => {
  await assert.rejects(() => readAllowance({ ...Q, fetch: mockFetch({}, false) }), /HTTP 500/);
});
