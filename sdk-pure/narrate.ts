// Narrated end-to-end run of the gist-style pure-SDK buy, with before/after balances, deltas, calldata decode
// (amountIn + amountOutMin), the slippage math, and the on-chain op-group. Self-contained (mint+list+fund+buy).
// Run: RS_API=http://127.0.0.1:3000 TOKEN=72 PRICE_XTZ=0.003 npx tsx sdk-pure/narrate.ts
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { MichelsonMap, OpKind, RpcForger, TezosToolkit } from '@taquito/taquito';
import type { ParamsWithKind } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import type { MichelsonV1Expression } from '@taquito/rpc';
import type { ObjktContract } from './types.js';
import { NATIVE_XTZ, SWAP_SIG, ThreeRouteApi, buildCallEvm, tzToAlias, wrapOperationParamsWithEvmApprove } from './helpers.js';

const env = readEnvFile(new URL('../.env', import.meta.url));
const need = (k: string): string => { const v = env[k]; if (!v) throw new Error(`missing ${k}`); return v; };
const TEZ_RPC = 'https://michelson.previewnet.tezosx.nomadic-labs.com';
const EVM_RPC = 'https://evm.previewnet.tezosx.nomadic-labs.com';
const TZKT = 'https://api.previewnet.tezosx.tzkt.io/v1';
const GATEWAY = 'KT18oDJJKXMKhfE1bSuAPGp92pYcwVDiqsPw';
const USDC = '0x39fD36e60A839DE4cB5DaE0E1009c0aa612Bfba1';
const OBJKT_V4 = env.V4_MKT ?? 'KT1DzhZkEN8UZ6NkhGMDbgHh2W5zLqHDq4G7';
const FA2 = 'KT1Mv4XGEJCvaqY8YmkU4NgDzQme5zwzSbCi';
const TOKEN = Number(process.env.TOKEN ?? 72);
const PRICE_XTZ = Number(process.env.PRICE_XTZ ?? 0.003);
const PRICE_MUTEZ = Math.round(PRICE_XTZ * 1e6);
const SLIPPAGE = 0.02; // 2%
const api = new ThreeRouteApi(process.env.RS_API ?? 'http://127.0.0.1:3000', 128064);

const m = {
  string: (s: string): MichelsonV1Expression => ({ string: s }), int: (n: number | string): MichelsonV1Expression => ({ int: String(n) }),
  pair: (...a: MichelsonV1Expression[]): MichelsonV1Expression => ({ prim: 'Pair', args: a }), right: (x: MichelsonV1Expression): MichelsonV1Expression => ({ prim: 'Right', args: [x] }),
  unit: { prim: 'Unit' } as MichelsonV1Expression, none: { prim: 'None' } as MichelsonV1Expression,
};
const makeToolkit = (sk: string): TezosToolkit => { const tk = new TezosToolkit(TEZ_RPC); tk.setProvider({ signer: new InMemorySigner(sk) }); tk.setForgerProvider(tk.getFactory(RpcForger)()); return tk; };
const provider = new ethers.JsonRpcProvider(EVM_RPC, undefined, { batchMaxCount: 1 });
const erc20 = (signer?: ethers.Wallet) => new ethers.Contract(USDC, ['function transfer(address,uint256) returns(bool)', 'function balanceOf(address) view returns(uint256)'], signer ?? provider) as unknown as { transfer(t: string, v: bigint): Promise<ethers.TransactionResponse>; balanceOf(a: string): Promise<bigint> };
const usdcBal = (a: string) => erc20().balanceOf(a);
const xtzMutez = async (a: string): Promise<bigint> => BigInt((await fetch(`${TEZ_RPC}/chains/main/blocks/head/context/contracts/${a}/balance`).then((r) => r.json()).catch(() => '0')) as string);
const nftOwner = async (id: number): Promise<string> => { const k = (await fetch(`${TZKT}/bigmaps/442/keys?key=${id}`).then((r) => r.json()).catch(() => [])) as Array<{ value?: string }>; return k[0]?.value ?? '(none)'; };
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const tezos = makeToolkit(need('TZ1_SK'));
const buyerTz1 = await tezos.signer.publicKeyHash();
const alias = tzToAlias(buyerTz1);
const seller = need('TD_SELLER');
const sellerTezos = makeToolkit(need('TD_SELLER_SK'));

console.log(`buyer tz1=${buyerTz1}  alias=${alias}\nseller=${seller}  token=${TOKEN}  price=${PRICE_XTZ} XTZ (${PRICE_MUTEZ} mutez)\n`);

// ── 1) quote + decode (amountIn / amountOutMin / slippage) ──────────────────────────────────────────
const SLIP_BPS = Math.round(SLIPPAGE * 10000); // 200
const priceWei = ethers.parseUnits(String(PRICE_XTZ), 18);
const targetWei = ((priceWei * BigInt(10000 + SLIP_BPS)) / 10000n).toString(); // exact-out target = price×(1+slippage)
const swap = await api.getSwap(USDC, NATIVE_XTZ, targetWei, alias, alias, SLIPPAGE * 100);
const word = (i: number) => BigInt('0x' + swap.tx.data.slice(10 + i * 64, 10 + (i + 1) * 64));
const cdAmountIn = word(0);
const cdAmountOutMin = word(1);
const cdTo = ethers.getAddress('0x' + swap.tx.data.slice(10 + 2 * 64 + 24, 10 + 3 * 64));
console.log('── QUOTE (rust-3route exact-out) ────────────────────────────');
console.log(`  srcAmount (pay)     = ${swap.srcAmount} USDC units`);
console.log(`  dstAmount (expected)= ${swap.dstAmount} wei  (= ${ethers.formatUnits(swap.dstAmount, 18)} XTZ)`);
console.log('  ── decoded from tx.data (router.swap args) ──');
console.log(`  [arg0] amountIn     = ${cdAmountIn} USDC units    (== srcAmount, exact-in calldata)`);
console.log(`  [arg1] amountOutMin = ${cdAmountOutMin} wei  (= ${ethers.formatUnits(cdAmountOutMin, 18)} XTZ)  ← slippage FLOOR`);
console.log(`  [arg2] to           = ${cdTo}  (= buyer alias; native auto-forwards to tz1)`);
console.log('  ── slippage math (server-side, in 3route swap.rs) ──');
console.log(`  target_wei      = price×(1+slip) = ${PRICE_XTZ}×${1 + SLIPPAGE} = ${ethers.formatUnits(targetWei, 18)} XTZ`);
console.log(`  amountOutMin    = target_wei×(1−slip) = target×0.98 = ${ethers.formatUnits(cdAmountOutMin, 18)} XTZ  (≈ price ${PRICE_XTZ})`);
console.log(`  floor ≥ price?  ${cdAmountOutMin >= priceWei ? 'YES' : 'NO'}  (router require(out≥amountOutMin); fulfill require(amount≥price))\n`);

// ── 2) setup: fund alias + mint/list ────────────────────────────────────────────────────────────────
const amountIn = BigInt(swap.srcAmount);
const have = await usdcBal(alias);
if (have < amountIn) {
  const wallet = new ethers.Wallet(need('EVM_PK'), provider);
  const eoaBal = await erc20(wallet).balanceOf(wallet.address);
  if (eoaBal < amountIn - have) throw new Error(`EOA short: ${eoaBal} < ${amountIn - have}`);
  console.log(`fund alias: +${amountIn - have} USDC from EOA`);
  await (await erc20(wallet).transfer(alias, amountIn - have)).wait();
}
if ((await nftOwner(TOKEN)) === '(none)') {
  console.log(`mint token ${TOKEN} -> seller`);
  await (await tezos.contract.transfer({ to: FA2, amount: 0, parameter: { entrypoint: 'mint', value: m.pair(m.string(seller), m.int(TOKEN)) }, gasLimit: 200_000, storageLimit: 350, fee: 50_000 })).confirmation();
}
const mkt = await sellerTezos.contract.at(OBJKT_V4);
const askId = ((await mkt.storage()) as { next_ask_id: { toNumber(): number } }).next_ask_id.toNumber();
const askValue = m.pair(m.pair(m.string(FA2), m.int(TOKEN)), m.right(m.right(m.unit)), m.int(PRICE_MUTEZ), m.int(1), [{ prim: 'Elt', args: [m.string(seller), m.int(1000)] }] as unknown as MichelsonV1Expression, m.none, m.none, m.int(0), m.none);
await (await sellerTezos.contract.transfer({ to: OBJKT_V4, amount: 0, parameter: { entrypoint: 'ask', value: askValue }, gasLimit: 1_500_000, storageLimit: 3_000, fee: 200_000 })).confirmation();
console.log(`listed ask#${askId} (token ${TOKEN} @ ${PRICE_XTZ} XTZ)\n`);

// ── 3) BEFORE snapshot ──────────────────────────────────────────────────────────────────────────────
const before = { aliasUsdc: await usdcBal(alias), buyerXtz: await xtzMutez(buyerTz1), sellerXtz: await xtzMutez(seller), owner: await nftOwner(TOKEN) };
console.log('── BEFORE ────────────────────────────────────────────────');
console.log(`  alias USDC = ${before.aliasUsdc}   buyer XTZ = ${before.buyerXtz} mutez   seller XTZ = ${before.sellerXtz} mutez   NFT owner = ${before.owner.slice(0, 14)}\n`);

// ── 4) build gist-style batch [approve, call_evm swap, fulfill_ask] and send ───────────────────────────
const objkt = await tezos.contract.at<ObjktContract>(OBJKT_V4);
const swapOp = buildCallEvm(GATEWAY, swap.tx.to, SWAP_SIG, swap.tx.data.slice(10));
const fulfillOp = objkt.methodsObject.fulfill_ask({ ask_id: String(askId), amount: '1', proxy_for: null, condition_extra: null, referrers: new MichelsonMap<string, string>() }).toTransferParams({ amount: PRICE_MUTEZ, mutez: true, gasLimit: 700_000, storageLimit: 2_000, fee: 150_000 });
let ops: ParamsWithKind[] = [{ kind: OpKind.TRANSACTION, ...swapOp }, { kind: OpKind.TRANSACTION, ...fulfillOp }];
ops = wrapOperationParamsWithEvmApprove({ operationParams: ops, gateway: GATEWAY, token: USDC, spender: swap.tx.to, amount: swap.srcAmount });
const op = await tezos.contract.batch().with(ops).send();
console.log(`>> op-group sent: ${op.hash}\n   https://previewnet.tezosx.tzkt.io/${op.hash}`);
await op.confirmation(1);
await delay(8_000);

// ── 5) AFTER snapshot + deltas ────────────────────────────────────────────────────────────────────────
const after = { aliasUsdc: await usdcBal(alias), buyerXtz: await xtzMutez(buyerTz1), sellerXtz: await xtzMutez(seller), owner: await nftOwner(TOKEN) };
console.log('\n── AFTER ─────────────────────────────────────────────────');
console.log(`  alias USDC = ${after.aliasUsdc}   buyer XTZ = ${after.buyerXtz} mutez   seller XTZ = ${after.sellerXtz} mutez   NFT owner = ${after.owner.slice(0, 14)}`);
console.log('── DELTAS ────────────────────────────────────────────────');
console.log(`  alias USDC : ${after.aliasUsdc - before.aliasUsdc}  (debited the swap input)`);
console.log(`  buyer XTZ  : ${after.buyerXtz - before.buyerXtz} mutez  (bridged-in − price − baker fees; ~net fees)`);
console.log(`  seller XTZ : ${after.sellerXtz - before.sellerXtz} mutez  (sale proceeds − marketplace fee/royalty)`);
console.log(`  NFT owner  : ${before.owner.slice(0, 10)} -> ${after.owner.slice(0, 14)}  ${after.owner === buyerTz1 ? '✅ delivered to buyer' : ''}`);

// ── 6) decode the on-chain op-group ────────────────────────────────────────────────────────────────────
console.log('\n── ON-CHAIN op-group (tzkt) ──────────────────────────────');
const opl = (await fetch(`${TZKT}/operations/${op.hash}`).then((r) => r.json()).catch(() => [])) as Array<Record<string, unknown>>;
for (const o of opl) {
  const p = (o.parameter as { entrypoint?: string }) ?? {};
  const tgt = ((o.target as { address?: string }) ?? {}).address ?? '';
  const snd = ((o.sender as { address?: string }) ?? {}).address ?? '';
  console.log(`  ${o.type} ${snd.slice(0, 10)}→${tgt.slice(0, 14)} ${p.entrypoint ?? ''} amount=${o.amount ?? 0} status=${o.status}`);
}

function readEnvFile(url: URL): Record<string, string> { const out: Record<string, string> = {}; for (const line of readFileSync(url, 'utf8').split('\n')) { const e = line.match(/^([A-Z0-9_]+)=(.*)$/); if (e) out[e[1] as string] = e[2] as string; } return out; }
