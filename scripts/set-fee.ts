// Admin helper: set the objkt fee_sharing_registry global management fee (bps). Signed by the registry
// admin (= BUYER_MICHELSON_SK in this test deploy). FEE=0 disables the 5% marketplace fee so a buyer pays
// exactly the listed price and the seller receives 100% (no treasury cut). Reversible: FEE=500 restores 5%.
//   Run:  FEE=0 npx tsx scripts/set-fee.ts
import { readFileSync } from 'node:fs';
import { InMemorySigner } from '@taquito/signer';
import { RpcForger, TezosToolkit } from '@taquito/taquito';

const FEE_SHARING_REGISTRY = 'KT1Kbevns6pZtjHwLgJbKVDgXHeoS9D7UbPw';
const sk = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/BUYER_MICHELSON_SK=(.*)/)?.[1];
if (!sk) throw new Error('BUYER_MICHELSON_SK missing in .env');
const fee = process.env.FEE ?? '0'; // bps (0 = no fee, 500 = 5%)

const tezos = new TezosToolkit('https://michelson.previewnet.tezosx.nomadic-labs.com');
tezos.setProvider({ signer: new InMemorySigner(sk) });
tezos.setForgerProvider(tezos.getFactory(RpcForger)()); // previewnet rejects local forging

console.log(`setting management_fee -> ${fee} bps …`);
const op = await tezos.contract.transfer({
  to: FEE_SHARING_REGISTRY,
  amount: 0,
  parameter: { entrypoint: 'update_management_fee', value: { int: fee } },
  gasLimit: 200_000,
  storageLimit: 200,
  fee: 50_000,
});
await op.confirmation();
console.log(`done: https://previewnet.tezosx.tzkt.io/${op.hash}`);
