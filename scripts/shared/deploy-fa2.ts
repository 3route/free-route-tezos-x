// scripts/shared/deploy-fa2.ts — originate the demo FA2 NFT from contracts/fa2_nft.json; print KT1 for .env TEST_FA2.
// On-chain token-id counter + TZIP-12/16 metadata. Deploys the committed JSON as-is.
// Edited fa2_nft.mligo? `npm run compile:fa2` + commit first. Run: `npm run deploy:fa2`.
import { readFileSync } from 'node:fs';
import { MichelsonMap, RpcForger, TezosToolkit } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import { stringToBytes } from '@taquito/utils';
import { need } from './env.js';

const MICHELSON_RPC = need('MICHELSON_RPC');
const sk = need('BUYER_MICHELSON_SK');

const code = JSON.parse(readFileSync(new URL('../../contracts/fa2_nft.json', import.meta.url), 'utf8'));

// TZIP-16 contract metadata, served from on-chain storage.
const contractMetadata = {
  name: 'objkt demo',
  description: 'Demo NFT collection for the objkt pay-with-any-ERC20 example (Tezos X previewnet).',
  version: '1.0.0',
  interfaces: ['TZIP-012', 'TZIP-016'],
  authors: ['objkt-evm-pay demo'],
};
// big_map (string, bytes) — Taquito takes bytes as hex strings, hence <string, string>.
const metadata = new MichelsonMap<string, string>();
metadata.set('', stringToBytes('tezos-storage:content'));
metadata.set('content', stringToBytes(JSON.stringify(contractMetadata)));

const storage = {
  ledger: new MichelsonMap(),
  operators: new MichelsonMap(),
  token_metadata: new MichelsonMap(),
  metadata,
  next_token_id: 0,
};

const tk = new TezosToolkit(MICHELSON_RPC);
tk.setProvider({ signer: new InMemorySigner(sk) });
tk.setForgerProvider(tk.getFactory(RpcForger)()); // previewnet rejects local forging

const deployer = await tk.signer.publicKeyHash();
console.log(`deploying FA2 from ${deployer} ...`);

// gas/storage estimate fine; only the fee needs pinning (previewnet's EVM-node policy > Taquito's estimate).
// No try/catch: TezosOperationError carries the real cause in `.errors` (e.g. BalanceTooLow).
const op = await tk.contract.originate({ code, storage, fee: 100_000 });
console.log(`origination op: ${op.hash}`);
await op.confirmation();
const { address } = await op.contract();

console.log(`\n✅ FA2 deployed: ${address}`);
console.log(`   Update .env:  TEST_FA2=${address}`);
