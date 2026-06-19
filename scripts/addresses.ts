// scripts/addresses.ts — print the buyer/seller Michelson addresses (derived from their SKs) + XTZ balances
import { TezosToolkit } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import { michelsonToEvmAlias } from '../src/index.js';
import { need } from './env.js';

const tk = new TezosToolkit(need('MICHELSON_RPC'));

for (const role of ['BUYER', 'SELLER'] as const) {
  const addr = await new InMemorySigner(need(`${role}_MICHELSON_SK`)).publicKeyHash();
  const xtz = (Number(await tk.tz.getBalance(addr)) / 1e6).toFixed(6);
  console.log(`${role.padEnd(6)} ${addr} · ${xtz} XTZ · alias ${michelsonToEvmAlias(addr)}`);
}
