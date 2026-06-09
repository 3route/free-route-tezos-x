// PROOF: the NFT price is paid by the SWAPPED XTZ (USDC -> XTZ, bridged), not the buyer's pre-existing XTZ.
// Method: drain tz1's XTZ down to a small buffer (enough for op fees only, << price), set the NFT price several
// times the fee, then buy. If it succeeds while tz1_balance < price, the bridged (swapped) XTZ must have funded
// fulfill_ask in-group. Restores the tz1 balance at the end. Run: RS_API=... TOKEN=73 npx tsx sdk-pure/proof-swapped-xtz.ts
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { MichelsonMap, OpKind, RpcForger, TezosToolkit } from '@taquito/taquito';
import type { ParamsWithKind, TransferParams } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import type { MichelsonV1Expression } from '@taquito/rpc';
import type { ObjktContract } from './types.js';
import { NATIVE_XTZ, SWAP_SIG, ThreeRouteApi, tzToAlias } from './helpers.js';

const env: Record<string, string> = {};
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) { const e = line.match(/^([A-Z0-9_]+)=(.*)$/); if (e) env[e[1] as string] = e[2] as string; }
const need = (k: string): string => { const v = env[k]; if (!v) throw new Error(`missing ${k}`); return v; };
const TEZ_RPC = 'https://michelson.previewnet.tezosx.nomadic-labs.com';
const EVM_RPC = 'https://evm.previewnet.tezosx.nomadic-labs.com';
const GATEWAY = 'KT18oDJJKXMKhfE1bSuAPGp92pYcwVDiqsPw';
const USDC = '0x39fD36e60A839DE4cB5DaE0E1009c0aa612Bfba1';
const OBJKT_V4 = env.V4_MKT ?? 'KT1DzhZkEN8UZ6NkhGMDbgHh2W5zLqHDq4G7';
const FA2 = 'KT1Mv4XGEJCvaqY8YmkU4NgDzQme5zwzSbCi';
const TOKEN = Number(process.env.TOKEN ?? 73);
const PRICE_MUTEZ = Number(process.env.PRICE_MUTEZ ?? 200_000); // 0.2 XTZ
const BUFFER_MUTEZ = Number(process.env.BUFFER_MUTEZ ?? 60_000); // ~0.06 XTZ left on tz1 — fees only, << price
const FEE = 12_000; // pinned fee per op so Σfees (~36k) clears the node floor (~22k) and stays < buffer (60k) < price (200k)
const api = new ThreeRouteApi(process.env.RS_API ?? 'http://127.0.0.1:3000', 128064);

const m = {
  string: (s: string): MichelsonV1Expression => ({ string: s }), int: (n: number | string): MichelsonV1Expression => ({ int: String(n) }),
  pair: (...a: MichelsonV1Expression[]): MichelsonV1Expression => ({ prim: 'Pair', args: a }), right: (x: MichelsonV1Expression): MichelsonV1Expression => ({ prim: 'Right', args: [x] }),
  unit: { prim: 'Unit' } as MichelsonV1Expression, none: { prim: 'None' } as MichelsonV1Expression,
};
const mk = (sk: string): TezosToolkit => { const tk = new TezosToolkit(TEZ_RPC); tk.setProvider({ signer: new InMemorySigner(sk) }); tk.setForgerProvider(tk.getFactory(RpcForger)()); return tk; };
const provider = new ethers.JsonRpcProvider(EVM_RPC, undefined, { batchMaxCount: 1 });
const usdcBal = (a: string) => (new ethers.Contract(USDC, ['function balanceOf(address) view returns(uint256)'], provider) as unknown as { balanceOf(x: string): Promise<bigint> }).balanceOf(a);
const xtz = async (a: string): Promise<bigint> => BigInt((await fetch(`${TEZ_RPC}/chains/main/blocks/head/context/contracts/${a}/balance`).then((r) => r.json())) as string);
const owner = async (id: number): Promise<string> => { const k = (await fetch(`https://api.previewnet.tezosx.tzkt.io/v1/bigmaps/442/keys?key=${id}`).then((r) => r.json()).catch(() => [])) as Array<{ value?: string }>; return k[0]?.value ?? '(none)'; };
const callEvmLowFee = (dest: string, sig: string, abiargs: string): TransferParams => ({ to: GATEWAY, amount: 0, parameter: { entrypoint: 'call_evm', value: { prim: 'Pair', args: [{ string: dest }, { string: sig }, { bytes: abiargs.replace(/^0x/, '') }, { prim: 'None' }] } }, gasLimit: 500_000, storageLimit: 2_000, fee: FEE });

const tezos = mk(need('TZ1_SK'));
const buyerTz1 = await tezos.signer.publicKeyHash();
const alias = tzToAlias(buyerTz1);
const sellerTezos = mk(need('TD_SELLER_SK'));
const seller = need('TD_SELLER');

// quote (exact-out) + ensure alias USDC is enough
const targetWei = ((BigInt(PRICE_MUTEZ) * 10n ** 12n * 102n) / 100n).toString(); // price×1.02 in wei
const swap = await api.getSwap(USDC, NATIVE_XTZ, targetWei, alias, alias, 2);
const amountIn = BigInt(swap.srcAmount);
console.log(`price=${PRICE_MUTEZ} mutez (${PRICE_MUTEZ / 1e6} XTZ) · pay ${amountIn} USDC · alias USDC=${await usdcBal(alias)}`);
if ((await usdcBal(alias)) < amountIn) throw new Error('alias short on USDC — run fund-usdc.ts first');

// mint + list at PRICE
if ((await owner(TOKEN)) === '(none)') { console.log(`mint ${TOKEN}`); await (await tezos.contract.transfer({ to: FA2, amount: 0, parameter: { entrypoint: 'mint', value: m.pair(m.string(seller), m.int(TOKEN)) }, gasLimit: 200_000, storageLimit: 350, fee: 50_000 })).confirmation(); }
const mkt = await sellerTezos.contract.at(OBJKT_V4);
const askId = ((await mkt.storage()) as { next_ask_id: { toNumber(): number } }).next_ask_id.toNumber();
const askValue = m.pair(m.pair(m.string(FA2), m.int(TOKEN)), m.right(m.right(m.unit)), m.int(PRICE_MUTEZ), m.int(1), [{ prim: 'Elt', args: [m.string(seller), m.int(1000)] }] as unknown as MichelsonV1Expression, m.none, m.none, m.int(0), m.none);
await (await sellerTezos.contract.transfer({ to: OBJKT_V4, amount: 0, parameter: { entrypoint: 'ask', value: askValue }, gasLimit: 1_500_000, storageLimit: 3_000, fee: 200_000 })).confirmation();
console.log(`listed ask#${askId} @ ${PRICE_MUTEZ} mutez`);

// DRAIN tz1 -> seller, leaving only BUFFER_MUTEZ
const full = await xtz(buyerTz1);
const drained = full - BigInt(BUFFER_MUTEZ) - 3000n;
console.log(`\nDRAIN: tz1 has ${full} mutez -> send ${drained} to seller, leave ~${BUFFER_MUTEZ}`);
await (await tezos.contract.transfer({ to: seller, amount: Number(drained), mutez: true, fee: 3000, gasLimit: 3000, storageLimit: 0 })).confirmation();
const tz1Before = await xtz(buyerTz1);
console.log(`tz1 balance now = ${tz1Before} mutez  (price = ${PRICE_MUTEZ})  →  tz1 < price? ${tz1Before < BigInt(PRICE_MUTEZ) ? 'YES (cannot pay from own XTZ)' : 'NO'}`);

// BUY with low fees: [approve, swap, fulfill]
const objkt = await tezos.contract.at<ObjktContract>(OBJKT_V4);
const abi = ethers.AbiCoder.defaultAbiCoder();
const approveOp = callEvmLowFee(USDC, 'approve(address,uint256)', abi.encode(['address', 'uint256'], [swap.tx.to, swap.srcAmount]));
const swapOp = callEvmLowFee(swap.tx.to, SWAP_SIG, swap.tx.data.slice(10));
const fulfillOp = objkt.methodsObject.fulfill_ask({ ask_id: String(askId), amount: '1', proxy_for: null, condition_extra: null, referrers: new MichelsonMap<string, string>() }).toTransferParams({ amount: PRICE_MUTEZ, mutez: true, gasLimit: 700_000, storageLimit: 2_000, fee: FEE });
const ops: ParamsWithKind[] = [{ kind: OpKind.TRANSACTION, ...approveOp }, { kind: OpKind.TRANSACTION, ...swapOp }, { kind: OpKind.TRANSACTION, ...fulfillOp }];

console.log(`\nBUY: Σ declared fees = ${3 * FEE} mutez (< buffer ${BUFFER_MUTEZ}); fulfill amount = ${PRICE_MUTEZ} mutez (> tz1 balance ${tz1Before})`);
try {
  const op = await tezos.contract.batch().with(ops).send();
  console.log('op:', op.hash);
  await op.confirmation(1);
  await new Promise((r) => setTimeout(r, 8000));
  const tz1After = await xtz(buyerTz1);
  const own = await owner(TOKEN);
  console.log(`\ntz1 XTZ: ${tz1Before} -> ${tz1After}   NFT owner -> ${own.slice(0, 14)}`);
  console.log(own === buyerTz1 && tz1Before < BigInt(PRICE_MUTEZ)
    ? `\n✅ PROVEN: tz1 had ${tz1Before} mutez < price ${PRICE_MUTEZ}, yet the NFT was bought → the SWAPPED XTZ (from USDC) paid for it in-group.`
    : `\n⚠️ inspect (owner=${own.slice(0, 14)}, tz1Before=${tz1Before})`);
} catch (e) {
  console.log('\n❌ buy rejected:', String((e as Error).message).split('\n')[0].slice(0, 160));
  console.log('   → would mean fulfill is validated against pre-bridge balance (the bridged XTZ does NOT fund same-group fulfill).');
}

// RESTORE tz1 balance (send the drained XTZ back from seller)
console.log('\nrestore: send drained XTZ back to tz1');
await (await sellerTezos.contract.transfer({ to: buyerTz1, amount: Number(drained), mutez: true, fee: 3000, gasLimit: 3000, storageLimit: 0 })).confirmation();
console.log(`tz1 restored = ${await xtz(buyerTz1)} mutez`);
