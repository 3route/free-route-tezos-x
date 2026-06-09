// CONTRACT-LESS e2e spike: buy an objkt NFT with USDC WITHOUT SwapBridge.
// Batch = [ call_evm USDC.approve(3route), call_evm 3route.swap(to=alias, dst=native), fulfill_ask ].
// The swap sends native XTZ to the buyer's EVM alias; the protocol auto-forwards it to the buyer tz1 (confirmed
// by probe-autoforward.ts); fulfill_ask then spends it. Tests: (B) happy path, (C) sold ask -> whole group reverts.
// Reuses universal SDK helpers + example's objkt op; harness (mint/list/fund) duplicated on purpose. Prod untouched.
// Run: RS_API=http://127.0.0.1:3000 PRICE=10000 npx tsx pure-sdk-spike/e2e.ts
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { TezosToolkit, RpcForger } from '@taquito/taquito';
import type { TransferParams } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import type { MichelsonV1Expression } from '@taquito/rpc';
import { PREVIEWNET, tzToAlias, mutezToWei, weiToMutez, encodeApproveArgs, getSwap, assertSupported, getTokens, NATIVE_XTZ, buildBatchTransaction } from '../sdk/index.js';
import type { ThreeRouteClient } from '../sdk/index.js';
import { buildFulfillAskOperation } from '../example/objkt.js';

// Real 3route router swap signature — selector 0x2dbbf153; call_evm needs sig + (calldata minus selector).
const SWAP_SIG = 'swap(uint256,uint256,address,uint256,uint256,(address[],uint256),(address,uint256)[],(address,uint256,uint256))';
const SIG_APPROVE = 'approve(address,uint256)';

const env = readEnvFile(new URL('../.env', import.meta.url));
const need = (k: string): string => { const v = env[k]; if (!v) throw new Error(`missing ${k} in .env`); return v; };
const GATEWAY = PREVIEWNET.gatewayTez;
const EVM_RPC = 'https://evm.previewnet.tezosx.nomadic-labs.com';
const TEZ_RPC = 'https://michelson.previewnet.tezosx.nomadic-labs.com';
const MICH_NODE = TEZ_RPC;
const USDC = '0x39fD36e60A839DE4cB5DaE0E1009c0aa612Bfba1';
const OBJKT_V4 = env.V4_MKT ?? 'KT1DzhZkEN8UZ6NkhGMDbgHh2W5zLqHDq4G7';
const FA2 = 'KT1Mv4XGEJCvaqY8YmkU4NgDzQme5zwzSbCi';
const PRICE_MUTEZ = Number(process.env.PRICE ?? 10_000);
const client: ThreeRouteClient = { baseUrl: process.env.RS_API ?? 'http://127.0.0.1:3000', chainId: Number(process.env.RS_CHAIN ?? 128064) };

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const m = {
  string: (s: string): MichelsonV1Expression => ({ string: s }),
  int: (n: number | string): MichelsonV1Expression => ({ int: String(n) }),
  pair: (...args: MichelsonV1Expression[]): MichelsonV1Expression => ({ prim: 'Pair', args }),
  right: (x: MichelsonV1Expression): MichelsonV1Expression => ({ prim: 'Right', args: [x] }),
  unit: { prim: 'Unit' } as MichelsonV1Expression,
  none: { prim: 'None' } as MichelsonV1Expression,
};

const tezos = makeToolkit(need('TZ1_SK'));
const provider = new ethers.JsonRpcProvider(EVM_RPC, undefined, { batchMaxCount: 1 });
const buyerTz1 = await tezos.signer.publicKeyHash();
const alias = tzToAlias(buyerTz1);

// --- contract-less batch builder ------------------------------------------------------------------
// call_evm Micheline param: %call_evm(string dest, string sig, bytes abiargs, option callback=None).
const callEvm = (dest: string, sig: string, abiargsNo0x: string): TransferParams => ({
  to: GATEWAY,
  amount: 0,
  parameter: { entrypoint: 'call_evm', value: { prim: 'Pair', args: [{ string: dest }, { string: sig }, { bytes: abiargsNo0x }, { prim: 'None' }] } },
  gasLimit: 500_000,
  storageLimit: 2_000,
  fee: 150_000,
});

async function buildBatch(askId: number) {
  // exact-out quote: from/receiver = ALIAS (no SwapBridge). Native output -> alias -> auto-forward -> tz1.
  const resp = await getSwap(client, { src: USDC, dst: NATIVE_XTZ, amount: mutezToWei(PRICE_MUTEZ), from: alias, receiver: alias, slippage: Number(process.env.SLIPPAGE ?? 2), isExactOutput: true });
  const amountIn = BigInt(resp.srcAmount);
  const router = resp.tx.to;
  const swapAbiargs = resp.tx.data.slice(10); // strip 0x + 4-byte selector
  console.log(`[3route] exact-out ${PRICE_MUTEZ} mutez XTZ <- ${amountIn} USDC units · router ${router} · to=alias`);

  const approveOp = callEvm(USDC, SIG_APPROVE, encodeApproveArgs(router, amountIn).slice(2));
  const swapOp = callEvm(router, SWAP_SIG, swapAbiargs);
  const fulfillOp = buildFulfillAskOperation({ objkt: OBJKT_V4, askId, priceMutez: PRICE_MUTEZ });
  return { ops: buildBatchTransaction([approveOp, swapOp, fulfillOp], { cfg: PREVIEWNET }), amountIn, router };
}

// --- run -------------------------------------------------------------------------------------------
const tokenId = Number(process.env.TOKEN ?? 70);
const askId = await createTestListing(tokenId);
const { amountIn } = await buildBatch(askId);
await ensureAliasFunded(alias, USDC, amountIn);

console.log(`\n=== (B) HAPPY PATH — contract-less buy, ask#${askId} token ${tokenId} ===`);
const ownerBefore = await ownerOf(tokenId);
const buy = await buildBatch(askId); // re-quote fresh
const op = await tezos.contract.batch(buy.ops).send();
console.log('  group:', op.hash, `https://previewnet.tezosx.tzkt.io/${op.hash}`);
await op.confirmation();
await delay(5_000);
const ownerAfter = await ownerOf(tokenId);
console.log(`  token ${tokenId} owner: ${ownerBefore} -> ${ownerAfter}`);
console.log(ownerAfter === buyerTz1 ? '  ✅ (B) NFT delivered to buyer tz1 — contract-less swap+auto-forward+fulfill works.' : '  ⚠️ (B) unexpected owner.');

console.log(`\n=== (C) ATOMICITY — re-buy the SOLD ask#${askId}, expect whole-group revert, USDC NOT pulled ===`);
const usdcBefore = await usdcBal(alias);
try {
  const retry = await buildBatch(askId); // same (now consumed) ask
  const op2 = await tezos.contract.batch(retry.ops).send();
  await op2.confirmation();
  console.log('  ⚠️ (C) group unexpectedly applied — inspect', op2.hash);
} catch (e) {
  console.log('  group rejected (expected):', String((e as Error).message).split('\n')[0].slice(0, 120));
}
await delay(3_000);
const usdcAfter = await usdcBal(alias);
console.log(`  alias USDC: ${usdcBefore} -> ${usdcAfter}`);
console.log(usdcAfter === usdcBefore ? '  ✅ (C) USDC NOT pulled on the failed group — atomic rollback holds.' : '  ⚠️ (C) USDC changed — inspect.');

// --- helpers (duplicated harness) ------------------------------------------------------------------
function makeToolkit(sk: string): TezosToolkit {
  const tk = new TezosToolkit(TEZ_RPC);
  tk.setProvider({ signer: new InMemorySigner(sk) });
  tk.setForgerProvider(tk.getFactory(RpcForger)());
  return tk;
}
function readEnvFile(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(url, 'utf8').split('\n')) { const e = line.match(/^([A-Z0-9_]+)=(.*)$/); if (e) out[e[1] as string] = e[2] as string; }
  return out;
}
async function ownerOf(id: number): Promise<string> {
  const keys = (await fetch(`https://api.previewnet.tezosx.tzkt.io/v1/bigmaps/442/keys?key=${id}`).then((r) => r.json()).catch(() => [])) as Array<{ value?: string }>;
  return keys[0]?.value ?? '(none)';
}
async function usdcBal(addr: string): Promise<bigint> {
  const c = new ethers.Contract(USDC, ['function balanceOf(address) view returns(uint256)'], provider) as unknown as { balanceOf(a: string): Promise<bigint> };
  return c.balanceOf(addr);
}
async function ensureAliasFunded(a: string, token: string, amt: bigint): Promise<void> {
  const erc = new ethers.Contract(token, ['function transfer(address,uint256) returns(bool)', 'function balanceOf(address) view returns(uint256)'], new ethers.Wallet(need('EVM_PK'), provider)) as unknown as { transfer(to: string, v: bigint): Promise<ethers.TransactionResponse>; balanceOf(x: string): Promise<bigint> };
  const have = await erc.balanceOf(a);
  if (have >= amt) { console.log(`alias holds ${have} USDC (need ${amt}) — no top-up`); return; }
  const need_ = amt - have;
  const eoa = await new ethers.Wallet(need('EVM_PK')).getAddress();
  const eoaBal = await erc.balanceOf(eoa);
  if (eoaBal < need_) throw new Error(`fund alias ${a} with >= ${need_} more USDC units; EOA ${eoa} holds ${eoaBal}`);
  console.log(`top up alias with ${need_} USDC from EOA`);
  await (await erc.transfer(a, need_)).wait();
}
async function createTestListing(id: number): Promise<number> {
  const seller = need('TD_SELLER');
  const sellerTezos = makeToolkit(need('TD_SELLER_SK'));
  if ((await ownerOf(id)) === '(none)') {
    console.log(`mint token ${id} -> seller`);
    await (await tezos.contract.transfer({ to: FA2, amount: 0, parameter: { entrypoint: 'mint', value: m.pair(m.string(seller), m.int(id)) }, gasLimit: 200_000, storageLimit: 350, fee: 50_000 })).confirmation();
  }
  const mkt = await sellerTezos.contract.at(OBJKT_V4);
  const newAsk = ((await mkt.storage()) as { next_ask_id: { toNumber(): number } }).next_ask_id.toNumber();
  console.log(`seller creates ask#${newAsk} (token ${id})`);
  await (await sellerTezos.contract.transfer({ to: OBJKT_V4, amount: 0, parameter: { entrypoint: 'ask', value: askValue(seller, id) }, gasLimit: 1_500_000, storageLimit: 3_000, fee: 200_000 })).confirmation();
  return newAsk;
}
function askValue(seller: string, id: number): MichelsonV1Expression {
  const token = m.pair(m.string(FA2), m.int(id));
  const currencyTez = m.right(m.right(m.unit));
  const shares = [{ prim: 'Elt', args: [m.string(seller), m.int(1000)] }] as unknown as MichelsonV1Expression;
  return m.pair(token, currencyTez, m.int(PRICE_MUTEZ), m.int(1), shares, m.none, m.none, m.int(0), m.none);
}
