import type { ParamsWithKind, TezosToolkit } from '@taquito/taquito';
import { estimateMichelsonOperation } from '../../src/index.js';

// For a contract signer (InMemorySigner — scripts). Wallet consumers send via tezos.wallet.batch() themselves.
/**
 * Size a prepared op group on the node (call_evm ops get the SDK's margin; the group is checked end-to-end before
 * signing), then send it as ONE atomic batch; waits 1 confirmation; returns the op hash.
 */
export async function sendGroup(tezos: TezosToolkit, ops: ParamsWithKind[]): Promise<string> {
  const readyOps = await estimateMichelsonOperation({ tezos, ops });
  const op = await tezos.contract.batch().with(readyOps).send();
  await op.confirmation(1);
  return op.hash;
}
