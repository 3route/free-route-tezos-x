// scripts/shared/deploy-objkt.ts — originate the whole objkt v4 system on Tezos X previewnet in one run,
// with the marketplace fee already zeroed (management_fee = 0), so a buyer pays exactly the listed
// price and the seller keeps 100% — no separate set-fee step.
//
// Three contracts, a clean dependency DAG (no cycles):
//   permission_module  ->  (nothing)
//   fee_sharing_registry -> permission_module          (holds management_fee — set to 0 here)
//   marketplace          -> permission_module + fee_sharing_registry
// originated in that order, wiring each address into the next. Code blobs are committed under
// contracts/objkt/ (pulled 1:1 from the live deploy). The deployer (BUYER_MICHELSON_SK) becomes
// admin / treasury / gallery_factory, matching the current setup.
//
// After it runs, put the printed marketplace KT1 into `.env` as OBJKT_MARKETPLACE.
// Run:  npm run deploy:objkt
import { readFileSync } from 'node:fs';
import { MichelsonMap, RpcForger, TezosToolkit } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import { need } from './env.js';

const MICHELSON_RPC = need('MICHELSON_RPC');
const sk = need('BUYER_MICHELSON_SK');

const tk = new TezosToolkit(MICHELSON_RPC);
tk.setProvider({ signer: new InMemorySigner(sk) });
tk.setForgerProvider(tk.getFactory(RpcForger)()); // previewnet rejects local forging
const admin = await tk.signer.publicKeyHash();
console.log(`deploying objkt system from ${admin} ...`);

const codeOf = (name: string) => JSON.parse(readFileSync(new URL(`../../contracts/objkt/${name}.json`, import.meta.url), 'utf8'));

// gas/storage estimate fine (marketplace: ~12k gas / ~30k storage, far under the 3M/60k ceilings);
// only the fee needs pinning — previewnet's EVM-node fee policy is stricter than Taquito's fee estimate.
const originate = async ({ name, storage, fee }: { name: string; storage: object; fee: number }) => {
  console.log(`originate ${name} ...`);
  const op = await tk.contract.originate({ code: codeOf(name), storage, fee });
  await op.confirmation();
  const { address } = await op.contract();
  console.log(`  ${name} = ${address}`);
  return address;
};

// 1) permission_module — admin/treasury/etc. all the deployer; no deps.
const pm = await originate({
  name: 'permission_module', fee: 50_000, storage: {
    admin,
    baking_reward_collector: admin,
    delegate: admin,
    metadata: new MichelsonMap(),
    mods: [],
    proposed_admin: null,
    treasury: admin,
  }
});

// 2) fee_sharing_registry — management_fee = 0 (the whole point); references the PM.
const registry = await originate({
  name: 'fee_registry', fee: 50_000, storage: {
    base_share_fee: 4000,
    fee_overrides: new MichelsonMap(),
    management_fee: 0,
    management_fee_overrides: new MichelsonMap(),
    metadata: new MichelsonMap(),
    permission_module: pm,
    referral_fee_levels: [0, 500, 1000, 1500, 2000, 2500],
  }
});

// 3) marketplace — references the PM + registry.
// larger fee: the marketplace blob is big, so its byte-based fee floor is higher
const marketplace = await originate({
  name: 'marketplace', fee: 200_000, storage: {
    asks: new MichelsonMap(),
    fee_sharing_registry: registry,
    gallery_factory: admin,
    metadata: new MichelsonMap(),
    next_ask_id: 0,
    next_offer_id: 0,
    offers: new MichelsonMap(),
    permission_module: pm,
  }
});

console.log(`\n✅ objkt system deployed (management_fee = 0):`);
console.log(`   permission_module    ${pm}`);
console.log(`   fee_sharing_registry ${registry}`);
console.log(`   marketplace          ${marketplace}`);
console.log(`\n   Update .env:  OBJKT_MARKETPLACE=${marketplace}`);
