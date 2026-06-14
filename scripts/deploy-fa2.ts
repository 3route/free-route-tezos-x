// scripts/deploy-fa2.ts — originate the demo FA2 NFT (contracts/fa2_nft.mligo) on Tezos X previewnet.
//
// The new contract assigns token ids on-chain (next_token_id counter) and carries TZIP-12 per-token
// metadata + TZIP-16 contract metadata, so ids never collide and explorers/wallets render it as a
// proper NFT collection. After it deploys, put the printed KT1 into `.env` as TEST_FA2.
//
// Compile first:  ligo compile contract contracts/fa2_nft.mligo --michelson-format json -o contracts/fa2_nft.json
// Run:            npx tsx scripts/deploy-fa2.ts
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MichelsonMap, RpcForger, TezosToolkit } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import { char2Bytes } from '@taquito/utils';
import { need } from './env.js';

const MICHELSON_RPC = need('MICHELSON_RPC');
const sk = need('SELLER_MICHELSON_SK');

// Recompile from source so we never deploy stale bytecode; fall back to the committed JSON if ligo is absent.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
try {
  execSync('ligo compile contract contracts/fa2_nft.mligo --michelson-format json -o contracts/fa2_nft.json', { cwd: repoRoot, stdio: 'inherit' });
} catch {
  console.warn('⚠️  ligo compile failed/unavailable — deploying the existing contracts/fa2_nft.json');
}
const code = JSON.parse(readFileSync(new URL('../contracts/fa2_nft.json', import.meta.url), 'utf8'));

// TZIP-16 contract metadata, served from on-chain storage (tezos-storage:content).
const contractMetadata = {
  name: 'objkt demo',
  description: 'Demo NFT collection for the objkt pay-with-any-ERC20 example (Tezos X previewnet).',
  version: '1.0.0',
  interfaces: ['TZIP-012', 'TZIP-016'],
  authors: ['objkt-evm-pay demo'],
};
const metadata = new MichelsonMap<string, string>();
metadata.set('', char2Bytes('tezos-storage:content'));
metadata.set('content', char2Bytes(JSON.stringify(contractMetadata)));

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

// previewnet's fee policy is stricter than taquito's auto-estimate — set fee/limits explicitly.
const op = await tk.contract.originate({ code, storage, fee: 100_000, gasLimit: 200_000, storageLimit: 20_000 });
console.log(`origination op: ${op.hash}`);
await op.confirmation();
const { address } = await op.contract();

console.log(`\n✅ FA2 deployed: ${address}`);
console.log(`   Update .env:  TEST_FA2=${address}`);
