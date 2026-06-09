// scripts/setup.ts — bootstrap a runnable demo from scratch:
//   1. mint a fresh test NFT on TEST_FA2 (to the seller),
//   2. list it as an ask on the objkt v4 marketplace (priced in XTZ),
//   3. fund the buyer's EVM alias with the pay-token by swapping a little of the buyer's XTZ via the router.
// Then prints the ready `npm run example` command (with ASK_ID / TOKEN / PRICE_XTZ / PAY).
// Run: RS_API=http://127.0.0.1:3000 [PAY=USDC PRICE_XTZ=0.004 FUND_XTZ=0.1] npx tsx scripts/setup.ts
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { RpcForger, TezosToolkit } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import type { MichelsonV1Expression } from '@taquito/rpc';
import { NATIVE_XTZ, SWAP_SIG, ThreeRouteApi, tzToAlias } from '../sdk/helpers.js';

const env = { ...readEnvFile('../.env'), ...readEnvFile('../.env.setup') }; // .env (shared) + setup-only extras
const need = (k: string): string => { const v = env[k]; if (!v) throw new Error(`missing ${k} in .env / .env.setup`); return v; };

const TEZ_RPC = 'https://michelson.previewnet.tezosx.nomadic-labs.com';
const EVM_RPC = 'https://evm.previewnet.tezosx.nomadic-labs.com';
const GATEWAY = 'KT18oDJJKXMKhfE1bSuAPGp92pYcwVDiqsPw'; // Michelson->EVM gateway
const CHAIN_ID = 128064;
const RS_API = process.env.RS_API ?? 'http://127.0.0.1:3000';
const OBJKT = need('OBJKT_MARKETPLACE');
const FA2 = need('TEST_FA2');

const PAY = process.env.PAY ?? 'USDC';
const PRICE_XTZ = Number(process.env.PRICE_XTZ ?? 0.004);
const FUND_XTZ = Number(process.env.FUND_XTZ ?? 0.1); // XTZ to swap -> pay-token when the alias is short
const SLIPPAGE_BPS = 200; // 2%
const PRICE_MUTEZ = Math.round(PRICE_XTZ * 1e6);
const TOKEN = Number(process.env.TOKEN ?? Date.now()); // fresh id per run unless pinned

// Micheline builders (objkt `ask` + FA2 `mint` need raw params — not in the typed ObjktContract).
const m = {
  string: (s: string): MichelsonV1Expression => ({ string: s }),
  int: (n: number | string): MichelsonV1Expression => ({ int: String(n) }),
  pair: (...a: MichelsonV1Expression[]): MichelsonV1Expression => ({ prim: 'Pair', args: a }),
  right: (x: MichelsonV1Expression): MichelsonV1Expression => ({ prim: 'Right', args: [x] }),
  unit: { prim: 'Unit' } as MichelsonV1Expression,
  none: { prim: 'None' } as MichelsonV1Expression,
};
const mk = (sk: string): TezosToolkit => {
  const tk = new TezosToolkit(TEZ_RPC);
  tk.setProvider({ signer: new InMemorySigner(sk) });
  tk.setForgerProvider(tk.getFactory(RpcForger)()); // previewnet rejects local forging
  return tk;
};
const owner = async (id: number): Promise<string> => {
  const keys = (await fetch(`https://api.previewnet.tezosx.tzkt.io/v1/bigmaps/442/keys?key=${id}`).then((r) => r.json()).catch(() => [])) as Array<{ value?: string }>;
  return keys[0]?.value ?? '(none)';
};

const buyer = mk(need('BUYER_TZ1_SK'));
const seller = mk(need('SELLER_TZ1_SK'));
const buyerTz1 = await buyer.signer.publicKeyHash();
const sellerTz1 = need('SELLER_TZ1');
const alias = tzToAlias(buyerTz1);
console.log(`buyer ${buyerTz1} (alias ${alias}) · seller ${sellerTz1}`);

// 1) MINT a fresh token to the seller (FA2 `mint(owner, token_id)`), unless it already exists.
if ((await owner(TOKEN)) === '(none)') {
  console.log(`mint token ${TOKEN} -> seller`);
  await (await seller.contract.transfer({ to: FA2, amount: 0, parameter: { entrypoint: 'mint', value: m.pair(m.string(sellerTz1), m.int(TOKEN)) }, gasLimit: 200_000, storageLimit: 350, fee: 50_000 })).confirmation();
} else {
  console.log(`token ${TOKEN} already exists — skip mint`);
}

// 2) LIST the ask on objkt v4 (price in XTZ). ask id = current next_ask_id.
const marketplace = await seller.contract.at(OBJKT);
const askId = ((await marketplace.storage()) as { next_ask_id: { toNumber(): number } }).next_ask_id.toNumber();
const askValue = m.pair(
  m.pair(m.string(FA2), m.int(TOKEN)), // token = (fa2, token_id)
  m.right(m.right(m.unit)), // currency = XTZ
  m.int(PRICE_MUTEZ), // price
  m.int(1), // editions
  [{ prim: 'Elt', args: [m.string(sellerTz1), m.int(1000)] }] as unknown as MichelsonV1Expression, // shares: seller 100%
  m.none, m.none, m.int(0), m.none,
);
await (await seller.contract.transfer({ to: OBJKT, amount: 0, parameter: { entrypoint: 'ask', value: askValue }, gasLimit: 1_500_000, storageLimit: 3_000, fee: 200_000 })).confirmation();
console.log(`listed ask#${askId} · token ${TOKEN} @ ${PRICE_MUTEZ} mutez (${PRICE_XTZ} XTZ)`);

// 3) FUND the alias with the pay-token if it's short. Needed amount = exact-out quote (price x slippage).
const api = new ThreeRouteApi(RS_API, CHAIN_ID);
const payToken = (await api.getTokens()).find((t) => t.symbol === PAY);
if (!payToken) throw new Error(`pay-token ${PAY} not in the 3route registry`);
const provider = new ethers.JsonRpcProvider(EVM_RPC, undefined, { batchMaxCount: 1 });
const erc20 = new ethers.Contract(payToken.address, ['function balanceOf(address) view returns (uint256)'], provider) as unknown as { balanceOf(a: string): Promise<bigint> };

const targetWei = ((BigInt(PRICE_MUTEZ) * 10n ** 12n * (10000n + BigInt(SLIPPAGE_BPS))) / 10000n).toString(); // price x (1+slip), wei
const buyQuote = await api.getSwap(payToken.address, NATIVE_XTZ, targetWei, alias, alias, SLIPPAGE_BPS / 100);
const needed = BigInt(buyQuote.srcAmount); // pay-token units the example will spend
const have = await erc20.balanceOf(alias);
console.log(`alias ${PAY}: have ${have} · need ${needed} for this buy`);

if (have < needed) {
  const fundMutez = Math.round(FUND_XTZ * 1e6);
  const fundWei = (BigInt(fundMutez) * 10n ** 12n).toString();
  const q = new URLSearchParams({ src: NATIVE_XTZ, dst: payToken.address, amount: fundWei, from: alias, receiver: alias, slippage: '3' });
  const fundSwap = (await fetch(`${RS_API}/api/v6.1/${CHAIN_ID}/swap?${q}`).then((r) => r.json())) as { dstAmount: string; tx: { to: string; data: string } };
  console.log(`fund: swap ${FUND_XTZ} XTZ -> ~${fundSwap.dstAmount} ${PAY} units (router ${fundSwap.tx.to})`);
  await (await buyer.contract.transfer({
    to: GATEWAY, amount: fundMutez, mutez: true,
    parameter: { entrypoint: 'call_evm', value: { prim: 'Pair', args: [{ string: fundSwap.tx.to }, { string: SWAP_SIG }, { bytes: fundSwap.tx.data.slice(10) }, { prim: 'None' }] } },
    gasLimit: 500_000, storageLimit: 2_000, fee: 150_000,
  })).confirmation();
  await new Promise((r) => setTimeout(r, 4000));
  console.log(`alias ${PAY} now = ${await erc20.balanceOf(alias)}`);
} else {
  console.log(`alias already funded — skip`);
}

console.log(`\n✅ ready. Run the example:\n   RS_API=${RS_API} ASK_ID=${askId} TOKEN=${TOKEN} PRICE_XTZ=${PRICE_XTZ} PAY=${PAY} npm run example`);

function readEnvFile(rel: string): Record<string, string> {
  const out: Record<string, string> = {};
  let text: string;
  try { text = readFileSync(new URL(rel, import.meta.url), 'utf8'); } catch { return out; } // tolerant: file may be absent
  for (const line of text.split('\n')) {
    const e = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (e) out[e[1] as string] = e[2] as string;
  }
  return out;
}
