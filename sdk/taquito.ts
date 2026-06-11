// taquito.ts — optional send helper. The SDK's job is to PREPARE ops; sending is the consumer's call. This
// is a convenience for a contract signer (InMemorySigner — scripts, the example). A wallet consumer
// (Beacon/Temple) should send the same ops via `tezos.wallet.batch().with(ops).send()` itself.
import type { ParamsWithKind, TezosToolkit } from '@taquito/taquito';

// Send a prepared op group as ONE atomic batch; waits 1 confirmation; returns the operation hash.
export async function sendGroup(tezos: TezosToolkit, ops: ParamsWithKind[]): Promise<string> {
  const op = await tezos.contract.batch().with(ops).send();
  await op.confirmation(1);
  return op.hash;
}
