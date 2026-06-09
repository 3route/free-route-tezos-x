// Decisive test: take estimate.batch's values, APPLY them to the ops, and actually SEND. If it succeeds we can
// drop the pinned constants (use pure emulate, like the gist). If it fails (cross-runtime / fees) we must pin.
// Run: RS_API=http://127.0.0.1:3000 TOKEN=75 npx tsx sdk-pure/estimate-apply.ts
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
const GATEWAY = 'KT18oDJJKXMKhfE1bSuAPGp92pYcwVDiqsPw';
const USDC = '0x39fD36e60A839DE4cB5DaE0E1009c0aa612Bfba1';
const OBJKT_V4 = env.V4_MKT ?? 'KT1DzhZkEN8UZ6NkhGMDbgHh2W5zLqHDq4G7';
const FA2 = 'KT1Mv4XGEJCvaqY8YmkU4NgDzQme5zwzSbCi';
const TOKEN = Number(process.env.TOKEN ?? 75);
const PRICE_MUTEZ = 3000;
const api = new ThreeRouteApi(process.env.RS_API ?? 'http://127.0.0.1:3000', 128064);

const m = { string: (s: string): MichelsonV1Expression => ({ string: s }), int: (n: number | string): MichelsonV1Expression => ({ int: String(n) }), pair: (...a: MichelsonV1Expression[]): MichelsonV1Expression => ({ prim: 'Pair', args: a }), right: (x: MichelsonV1Expression): MichelsonV1Expression => ({ prim: 'Right', args: [x] }), unit: { prim: 'Unit' } as MichelsonV1Expression, none: { prim: 'None' } as MichelsonV1Expression };
const mk = (sk: string): TezosToolkit => { const tk = new TezosToolkit(TEZ_RPC); tk.setProvider({ signer: new InMemorySigner(sk) }); tk.setForgerProvider(tk.getFactory(RpcForger)()); return tk; };
const owner = async (id: number): Promise<string> => { const k = (await fetch(`https://api.previewnet.tezosx.tzkt.io/v1/bigmaps/442/keys?key=${id}`).then((r) => r.json()).catch(() => [])) as Array<{ value?: string }>; return k[0]?.value ?? '(none)'; };
const callEvm = (dest: string, sig: string, abiargs: string): TransferParams => ({ to: GATEWAY, amount: 0, parameter: { entrypoint: 'call_evm', value: { prim: 'Pair', args: [{ string: dest }, { string: sig }, { bytes: abiargs.replace(/^0x/, '') }, { prim: 'None' }] } } });

const tezos = mk(need('TZ1_SK'));
const buyerTz1 = await tezos.signer.publicKeyHash();
const alias = tzToAlias(buyerTz1);
const sellerTezos = mk(need('TD_SELLER_SK'));
const seller = need('TD_SELLER');

if ((await owner(TOKEN)) === '(none)') { console.log(`mint ${TOKEN}`); await (await tezos.contract.transfer({ to: FA2, amount: 0, parameter: { entrypoint: 'mint', value: m.pair(m.string(seller), m.int(TOKEN)) }, gasLimit: 200_000, storageLimit: 350, fee: 50_000 })).confirmation(); }
const mkt = await sellerTezos.contract.at(OBJKT_V4);
const askId = ((await mkt.storage()) as { next_ask_id: { toNumber(): number } }).next_ask_id.toNumber();
await (await sellerTezos.contract.transfer({ to: OBJKT_V4, amount: 0, parameter: { entrypoint: 'ask', value: m.pair(m.pair(m.string(FA2), m.int(TOKEN)), m.right(m.right(m.unit)), m.int(PRICE_MUTEZ), m.int(1), [{ prim: 'Elt', args: [m.string(seller), m.int(1000)] }] as unknown as MichelsonV1Expression, m.none, m.none, m.int(0), m.none) }, gasLimit: 1_500_000, storageLimit: 3_000, fee: 200_000 })).confirmation();
console.log(`listed ask#${askId} (token ${TOKEN})`);

const swap = await api.getSwap(USDC, NATIVE_XTZ, (BigInt(PRICE_MUTEZ) * 10n ** 12n * 102n / 100n).toString(), alias, alias, 2);
const objkt = await tezos.contract.at<ObjktContract>(OBJKT_V4);
const abi = ethers.AbiCoder.defaultAbiCoder();
const baseOps: TransferParams[] = [
  callEvm(USDC, 'approve(address,uint256)', abi.encode(['address', 'uint256'], [swap.tx.to, swap.srcAmount])),
  callEvm(swap.tx.to, SWAP_SIG, swap.tx.data.slice(10)),
  objkt.methodsObject.fulfill_ask({ ask_id: String(askId), amount: '1', proxy_for: null, condition_extra: null, referrers: new MichelsonMap<string, string>() }).toTransferParams({ amount: PRICE_MUTEZ, mutez: true }),
];
const ops: ParamsWithKind[] = baseOps.map((o) => ({ kind: OpKind.TRANSACTION, ...o }));

const est = await tezos.estimate.batch(ops);
// APPLY estimate's values exactly (gasLimit / storageLimit / suggestedFee) — no constants
const applied: ParamsWithKind[] = ops.map((o, i) => ({ ...o, gasLimit: est[i].gasLimit, storageLimit: est[i].storageLimit, fee: est[i].suggestedFeeMutez }));
console.log('applying estimate:', applied.map((o) => `gas=${o.gasLimit} fee=${o.fee}`).join(' | '));

try {
  const op = await tezos.contract.batch().with(applied).send();
  console.log('op:', op.hash);
  await op.confirmation(1);
  await new Promise((r) => setTimeout(r, 8000));
  const own = await owner(TOKEN);
  console.log(`NFT owner -> ${own.slice(0, 14)}`);
  console.log(own === buyerTz1 ? '\n✅ ESTIMATE IS ENOUGH — applied values worked, NO pinned constants needed (pure emulate, like the gist).' : '\n⚠️ applied but owner unexpected — inspect.');
} catch (e) {
  console.log('\n❌ APPLIED-ESTIMATE FAILED:', String((e as Error).message).split('\n')[0].slice(0, 180));
  console.log('   → estimate under-provisions (call_evm EVM budget / fee floor); must pin / floor the call_evm gasLimit.');
}
