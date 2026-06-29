// scripts/e2e/assert.ts — on-chain assertions for the e2e suite. Everything is read live (FA2 ledger / ERC20
// balances) and polled, since the EVM-side state settles a moment after the Tezos confirmation.
import { strict as assert } from 'node:assert';
import type { TezosToolkit } from '@taquito/taquito';
import { readErc20Balance } from '../../src/index.js';

/** Read the FA2 ledger owner of a token (ledger: token_id -> address). `undefined` if unminted/burned. */
export async function nftOwner(tezos: TezosToolkit, fa2: string, tokenId: number): Promise<string | undefined> {
  const c = await tezos.contract.at(fa2);
  const ledger = (await c.storage() as { ledger: { get(id: number): Promise<string | undefined> } }).ledger;
  return ledger.get(tokenId);
}

/** Poll the FA2 ledger until token `tokenId` is owned by `expected`, then assert it (indexer/RPC lag). */
export async function assertNftOwner(tezos: TezosToolkit, fa2: string, tokenId: number, expected: string): Promise<void> {
  let owner: string | undefined;
  for (let i = 0; i < 12; i++) {
    owner = await nftOwner(tezos, fa2, tokenId);
    if (owner === expected) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  assert.equal(owner, expected, `NFT #${tokenId} should be owned by ${expected}`);
}

/**
 * Poll `owner`'s ERC20 balance until it grows by ≥ `minDelta` over `before`, then assert it (the swap output).
 *
 * Two invariants this relies on:
 *  - ERC20 dst only. The delta is read via `readErc20Balance`; native-XTZ output is 18-dec wei and (to an alias)
 *    auto-forwards to the tz1, so it would not show up here — assert XTZ output on the Michelson side instead.
 *  - Serialized access. `after - before` isolates the swap output ONLY if nothing else credits `owner` in the
 *    window. The e2e tests run strictly sequentially (single file, no node:test concurrency) and CI serializes
 *    whole runs (a concurrency group), so the shared accounts (alias / EVM account) see no overlapping writes.
 *    Do NOT parallelize tests on shared accounts — the deltas would collide.
 */
export async function assertReceived(
  evmRpc: string,
  token: string,
  owner: string,
  before: bigint,
  minDelta: bigint,
): Promise<bigint> {
  let after = before;
  for (let i = 0; i < 15; i++) {
    after = await readErc20Balance({ evmRpc, token, owner });
    if (after - before >= minDelta) return after - before;
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.ok(after - before >= minDelta, `received ${after - before} should be ≥ minOut ${minDelta} on ${owner}`);
  return after - before;
}
