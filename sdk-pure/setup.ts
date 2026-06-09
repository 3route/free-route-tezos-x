// setup.ts — test scaffolding (NOT part of the gist). On previewnet there is no live ask, so we mint a fresh
// NFT, list it on objkt v4, and fund the buyer alias with the input token. Prints ASK_ID/TOKEN to feed index.ts.
// Run: RS_API=http://127.0.0.1:3000 TOKEN=71 PRICE_XTZ=0.004 npx tsx sdk-pure/setup.ts
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { TezosToolkit, RpcForger } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import type { MichelsonV1Expression } from '@taquito/rpc';
import { NATIVE_XTZ, ThreeRouteApi, tzToAlias } from './helpers.js';

const env = readEnvFile(new URL('../.env', import.meta.url));
const need = (k: string): string => { const v = env[k]; if (!v) throw new Error(`missing ${k}`); return v; };
const TEZ_RPC = 'https://michelson.previewnet.tezosx.nomadic-labs.com';
const EVM_RPC = 'https://evm.previewnet.tezosx.nomadic-labs.com';
const USDC = '0x39fD36e60A839DE4cB5DaE0E1009c0aa612Bfba1';
const OBJKT_V4 = env.V4_MKT ?? 'KT1DzhZkEN8UZ6NkhGMDbgHh2W5zLqHDq4G7';
const FA2 = 'KT1Mv4XGEJCvaqY8YmkU4NgDzQme5zwzSbCi';
const TOKEN = Number(process.env.TOKEN ?? 71);
const PRICE_XTZ = Number(process.env.PRICE_XTZ ?? 0.004);
const PRICE_MUTEZ = Math.round(PRICE_XTZ * 1e6);
const api = new ThreeRouteApi(process.env.RS_API ?? 'http://127.0.0.1:3000', 128064);

const m = {
  string: (s: string): MichelsonV1Expression => ({ string: s }),
  int: (n: number | string): MichelsonV1Expression => ({ int: String(n) }),
  pair: (...args: MichelsonV1Expression[]): MichelsonV1Expression => ({ prim: 'Pair', args }),
  right: (x: MichelsonV1Expression): MichelsonV1Expression => ({ prim: 'Right', args: [x] }),
  unit: { prim: 'Unit' } as MichelsonV1Expression,
  none: { prim: 'None' } as MichelsonV1Expression,
};
const makeToolkit = (sk: string): TezosToolkit => {
  const tk = new TezosToolkit(TEZ_RPC);
  tk.setProvider({ signer: new InMemorySigner(sk) });
  tk.setForgerProvider(tk.getFactory(RpcForger)());
  return tk;
};
const ownerOf = async (id: number): Promise<string> => {
  const keys = (await fetch(`https://api.previewnet.tezosx.tzkt.io/v1/bigmaps/442/keys?key=${id}`).then((r) => r.json()).catch(() => [])) as Array<{ value?: string }>;
  return keys[0]?.value ?? '(none)';
};

const buyerTz1 = await new InMemorySigner(need('TZ1_SK')).publicKeyHash();
const alias = tzToAlias(buyerTz1);
const provider = new ethers.JsonRpcProvider(EVM_RPC, undefined, { batchMaxCount: 1 });
const usdc = new ethers.Contract(USDC, ['function transfer(address,uint256) returns(bool)', 'function balanceOf(address) view returns(uint256)'], new ethers.Wallet(need('EVM_PK'), provider)) as unknown as { transfer(t: string, v: bigint): Promise<ethers.TransactionResponse>; balanceOf(a: string): Promise<bigint> };

// fund the alias with the input amount the buy will need (quote the same exact-out as index.ts)
const exactOutTargetWei = ethers.parseUnits((PRICE_XTZ * 1.02).toString(), 18).toString();
const swap = await api.getSwap(USDC, NATIVE_XTZ, exactOutTargetWei, alias, alias, 2);
const amountIn = BigInt(swap.srcAmount);
const have = await usdc.balanceOf(alias);
if (have < amountIn) {
  const eoa = await new ethers.Wallet(need('EVM_PK')).getAddress();
  const eb = await usdc.balanceOf(eoa);
  if (eb < amountIn - have) throw new Error(`EOA short on USDC: has ${eb}, need ${amountIn - have}`);
  console.log(`fund alias with ${amountIn - have} USDC (need ${amountIn}, have ${have})`);
  await (await usdc.transfer(alias, amountIn - have)).wait();
} else console.log(`alias already holds ${have} USDC (need ${amountIn}) — no top-up`);

// mint + list as the test seller (creator must differ from the buyer)
const tezos = makeToolkit(need('TZ1_SK'));
const sellerTezos = makeToolkit(need('TD_SELLER_SK'));
const seller = need('TD_SELLER');
if ((await ownerOf(TOKEN)) === '(none)') {
  console.log(`mint token ${TOKEN} -> seller`);
  await (await tezos.contract.transfer({ to: FA2, amount: 0, parameter: { entrypoint: 'mint', value: m.pair(m.string(seller), m.int(TOKEN)) }, gasLimit: 200_000, storageLimit: 350, fee: 50_000 })).confirmation();
}
const mkt = await sellerTezos.contract.at(OBJKT_V4);
const askId = ((await mkt.storage()) as { next_ask_id: { toNumber(): number } }).next_ask_id.toNumber();
const askValue = m.pair(m.pair(m.string(FA2), m.int(TOKEN)), m.right(m.right(m.unit)), m.int(PRICE_MUTEZ), m.int(1), [{ prim: 'Elt', args: [m.string(seller), m.int(1000)] }] as unknown as MichelsonV1Expression, m.none, m.none, m.int(0), m.none);
console.log(`seller creates ask#${askId} (token ${TOKEN}, ${PRICE_XTZ} XTZ)`);
await (await sellerTezos.contract.transfer({ to: OBJKT_V4, amount: 0, parameter: { entrypoint: 'ask', value: askValue }, gasLimit: 1_500_000, storageLimit: 3_000, fee: 200_000 })).confirmation();

console.log(`\n=== ready — run the gist-style buy: ===`);
console.log(`RS_API=${process.env.RS_API ?? 'http://127.0.0.1:3000'} ASK_ID=${askId} TOKEN=${TOKEN} PRICE_XTZ=${PRICE_XTZ} npx tsx sdk-pure/index.ts`);

function readEnvFile(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(url, 'utf8').split('\n')) { const e = line.match(/^([A-Z0-9_]+)=(.*)$/); if (e) out[e[1] as string] = e[2] as string; }
  return out;
}
