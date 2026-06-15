import type { ParamsWithKind, TezosToolkit } from '@taquito/taquito';

// For a contract signer (InMemorySigner — scripts). Wallet consumers send via tezos.wallet.batch() themselves.
/** Send a prepared op group as ONE atomic batch; waits 1 confirmation; returns the op hash. */
export async function sendGroup(tezos: TezosToolkit, ops: ParamsWithKind[]): Promise<string> {
  const op = await tezos.contract.batch().with(ops).send();
  await op.confirmation(1);
  return op.hash;
}
