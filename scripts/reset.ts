// scripts/reset.ts — clean slate for the demo:
//   1. retract every active ask for the test FA2 on objkt (each signed by the ask's creator),
//   2. send all test-FA2 NFTs owned by the buyer and the seller to the burn address
//      (the test FA2 has no `burn` entrypoint, so we transfer them away).
// Run: npx tsx scripts/reset.ts
import { readFileSync } from 'node:fs';
import { OpKind, RpcForger, TezosToolkit } from '@taquito/taquito';
import type { ParamsWithKind } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';

const env = { ...readEnvFile('../.env'), ...readEnvFile('../.env.setup') };
const need = (k: string): string => { const v = env[k]; if (!v) throw new Error(`missing ${k} in .env / .env.setup`); return v; };

const TEZ_RPC = 'https://michelson.previewnet.tezosx.nomadic-labs.com';
const TZKT = 'https://api.previewnet.tezosx.tzkt.io/v1';
const OBJKT = need('OBJKT_MARKETPLACE');
const FA2 = need('TEST_FA2');
const LEDGER = 442;
const BURN = 'tz1burnburnburnburnburnburnburjAYjjX';

const mk = (sk: string): TezosToolkit => {
  const tk = new TezosToolkit(TEZ_RPC);
  tk.setProvider({ signer: new InMemorySigner(sk) });
  tk.setForgerProvider(tk.getFactory(RpcForger)());
  return tk;
};

const buyer = mk(need('BUYER_TZ1_SK'));
const seller = mk(need('SELLER_TZ1_SK'));
const buyerTz1 = await buyer.signer.publicKeyHash();
const sellerTz1 = need('SELLER_TZ1');
const signers: Record<string, TezosToolkit> = { [buyerTz1]: buyer, [sellerTz1]: seller };
console.log(`buyer ${buyerTz1} · seller ${sellerTz1} · burn ${BURN}`);

// ---------------- 1) retract all active asks ----------------
const asks = (await fetch(
  `${TZKT}/contracts/${OBJKT}/bigmaps/asks/keys?active=true&value.token.address=${FA2}&limit=200`,
).then((r) => r.json())) as Array<{ key: string; value: { creator: string } }>;
console.log(`\nactive asks: ${asks.length}`);

const byCreator = new Map<string, string[]>();
for (const a of asks) {
  if (!byCreator.has(a.value.creator)) byCreator.set(a.value.creator, []);
  byCreator.get(a.value.creator)!.push(a.key);
}
for (const [creator, askIds] of byCreator) {
  const tk = signers[creator];
  if (!tk) {
    console.log(`  ⚠️ ${askIds.length} asks by ${creator} — no key available, skipped`);
    continue;
  }
  const mkt = await tk.contract.at(OBJKT);
  const ops: ParamsWithKind[] = askIds.map((id) => ({
    kind: OpKind.TRANSACTION,
    ...mkt.methods.retract_ask!(Number(id)).toTransferParams({ gasLimit: 250_000, storageLimit: 100, fee: 20_000 }),
  }));
  const op = await tk.contract.batch().with(ops).send();
  console.log(`  retract ${askIds.length} asks by ${creator === buyerTz1 ? 'buyer' : 'seller'}: ${op.hash}`);
  await op.confirmation();
}

// ---------------- 2) burn all owned test NFTs ----------------
async function ownedBy(tz1: string): Promise<string[]> {
  const keys = (await fetch(`${TZKT}/bigmaps/${LEDGER}/keys?value=${tz1}&active=true&limit=200&select=key`).then((r) => r.json())) as string[];
  return keys;
}
for (const [tz1, tk] of [[buyerTz1, buyer], [sellerTz1, seller]] as const) {
  const tokenIds = await ownedBy(tz1);
  if (!tokenIds.length) {
    console.log(`\n${tz1 === buyerTz1 ? 'buyer' : 'seller'} owns no test NFTs`);
    continue;
  }
  const fa2 = await tk.contract.at(FA2);
  const txs = tokenIds.map((token_id) => ({ to_: BURN, token_id, amount: '1' }));
  const sent = await fa2.methodsObject.transfer!([{ from_: tz1, txs }]).send({ gasLimit: 1_500_000, storageLimit: 3_000, fee: 150_000 });
  console.log(`\nburn ${tokenIds.length} NFTs from ${tz1 === buyerTz1 ? 'buyer' : 'seller'} (${tokenIds.join(', ')}): ${sent.hash}`);
  await sent.confirmation();
}

console.log('\n✅ clean slate — no active listings, collection cleared. Run `npm run setup` (or the dApp Seller mode) to start fresh.');

function readEnvFile(rel: string): Record<string, string> {
  const out: Record<string, string> = {};
  let text: string;
  try { text = readFileSync(new URL(rel, import.meta.url), 'utf8'); } catch { return out; }
  for (const line of text.split('\n')) {
    const e = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (e) out[e[1] as string] = e[2] as string;
  }
  return out;
}
