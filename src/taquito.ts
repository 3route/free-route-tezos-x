// Optional send helper for a contract signer (InMemorySigner — scripts/examples). Wallet consumers
// (Beacon/Temple) send the prepared ops themselves via tezos.wallet.batch().with(ops).send().
import type { ParamsWithKind, TezosToolkit } from '@taquito/taquito';

/** Send a prepared op group as ONE atomic batch; waits 1 confirmation; returns the op hash. */
export async function sendGroup(tezos: TezosToolkit, ops: ParamsWithKind[]): Promise<string> {
  const op = await tezos.contract.batch().with(ops).send();
  await op.confirmation(1);
  return op.hash;
}
