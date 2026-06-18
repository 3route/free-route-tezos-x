// scripts/setup.ts — bootstrap a runnable demo from scratch:
//   1. mint a fresh test NFT on TEST_FA2 (to the seller),
//   2. list it as an ask on the objkt v4 marketplace (priced in XTZ),
//   3. fund the buyer's EVM alias with the pay-token by swapping a little of the buyer's XTZ via the router.
// Then prints the ready `npm run example` command (with ASK_ID / PRICE_XTZ / PAY).
// Config comes from .env; [PAY / PRICE_XTZ / FUND_XTZ] are optional per-run overrides.
// Run:  [PAY=USDC PRICE_XTZ=0.004 FUND_XTZ=0.1] npx tsx scripts/setup.ts
import { ethers } from 'ethers';
import { RpcForger, TezosToolkit } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import type { MichelsonV1Expression } from '@taquito/rpc';
import { FreeRouteTezosX, XTZ, michelsonToEvmAlias, targetForMinOut, tezosXPreviewnet, toEvm } from '../src/index.js';
import { need } from './env.js';
import { sendGroup } from './send.js';

const MICHELSON_RPC = need('MICHELSON_RPC');
const EVM_RPC = need('EVM_RPC');
const FREE_ROUTE_API = need('FREE_ROUTE_API');
const OBJKT = need('OBJKT_MARKETPLACE');
const FA2 = need('TEST_FA2');

const PAY = process.env.PAY ?? 'USDC';
const PRICE_XTZ = Number(process.env.PRICE_XTZ ?? 0.004);
const FUND_XTZ = Number(process.env.FUND_XTZ ?? 0.1); // XTZ to swap -> pay-token when the alias is short
const SLIPPAGE_BPS = 200; // 2%
const PRICE_MUTEZ = Math.round(PRICE_XTZ * 1e6);

// Micheline builders (objkt `ask` + FA2 `mint` need raw params — no adapter for these in the SDK).
const m = {
  string: (s: string): MichelsonV1Expression => ({ string: s }),
  int: (n: number | string): MichelsonV1Expression => ({ int: String(n) }),
  pair: (...a: MichelsonV1Expression[]): MichelsonV1Expression => ({ prim: 'Pair', args: a }),
  left: (x: MichelsonV1Expression): MichelsonV1Expression => ({ prim: 'Left', args: [x] }),
  right: (x: MichelsonV1Expression): MichelsonV1Expression => ({ prim: 'Right', args: [x] }),
  unit: { prim: 'Unit' } as MichelsonV1Expression,
  none: { prim: 'None' } as MichelsonV1Expression,
};
const mk = (sk: string): TezosToolkit => {
  const tk = new TezosToolkit(MICHELSON_RPC);
  tk.setProvider({ signer: new InMemorySigner(sk) });
  tk.setForgerProvider(tk.getFactory(RpcForger)()); // previewnet rejects local forging
  return tk;
};

const buyer = mk(need('BUYER_MICHELSON_SK'));
const seller = mk(need('SELLER_MICHELSON_SK'));
const buyerMichelsonAddress = await buyer.signer.publicKeyHash();
const sellerMichelsonAddress = need('SELLER_MICHELSON');
const aliasAddress = michelsonToEvmAlias(buyerMichelsonAddress);
const freeRoute = new FreeRouteTezosX({ network: tezosXPreviewnet, baseUrl: FREE_ROUTE_API });
console.log(`buyer ${buyerMichelsonAddress} (alias ${aliasAddress}) · seller ${sellerMichelsonAddress}`);

// 1) MINT a fresh token to the seller. The FA2 assigns the id itself (next_token_id counter), so
//    we read it just before minting — no client-side id, no collisions. mint takes only the owner.
const fa2 = await seller.contract.at(FA2);
const TOKEN = ((await fa2.storage()) as { next_token_id: { toNumber(): number } }).next_token_id.toNumber();
console.log(`mint token ${TOKEN} -> seller`);
await (await seller.contract.transfer({ to: FA2, amount: 0, parameter: { entrypoint: 'mint', value: m.string(sellerMichelsonAddress) }, gasLimit: 200_000, storageLimit: 500, fee: 50_000 })).confirmation();

// objkt pulls the NFT from the seller on fulfill, so the marketplace must be an FA2 operator for this token.
console.log(`approve objkt as operator for token ${TOKEN}`);
await (await seller.contract.transfer({ to: FA2, amount: 0, parameter: { entrypoint: 'update_operators', value: [m.left(m.pair(m.string(sellerMichelsonAddress), m.string(OBJKT), m.int(TOKEN)))] as unknown as MichelsonV1Expression }, gasLimit: 200_000, storageLimit: 350, fee: 50_000 })).confirmation();

// 2) LIST the ask on objkt v4 (price in XTZ). ask id = current next_ask_id.
const marketplace = await seller.contract.at(OBJKT);
const askId = ((await marketplace.storage()) as { next_ask_id: { toNumber(): number } }).next_ask_id.toNumber();
const askValue = m.pair(
  m.pair(m.string(FA2), m.int(TOKEN)), // token = (fa2, token_id)
  m.right(m.right(m.unit)), // currency = XTZ
  m.int(PRICE_MUTEZ), // price
  m.int(1), // editions
  [{ prim: 'Elt', args: [m.string(sellerMichelsonAddress), m.int(1000)] }] as unknown as MichelsonV1Expression, // shares: seller 100%
  m.none, m.none, m.int(0), m.none,
);
await (await seller.contract.transfer({ to: OBJKT, amount: 0, parameter: { entrypoint: 'ask', value: askValue }, gasLimit: 1_500_000, storageLimit: 3_000, fee: 200_000 })).confirmation();
console.log(`listed ask#${askId} · token ${TOKEN} @ ${PRICE_MUTEZ} mutez (${PRICE_XTZ} XTZ)`);

// 3) FUND the alias with the pay-token if it's short. Needed amount = the example's exact-out buy input.
const payToken = (await freeRoute.getTokens()).find((t) => t.symbol === PAY);
if (!payToken) throw new Error(`pay-token ${PAY} not in the free-route registry`);
const provider = new ethers.JsonRpcProvider(EVM_RPC, undefined, { batchMaxCount: 1 });
const erc20 = new ethers.Contract(payToken.address, ['function balanceOf(address) view returns (uint256)'], provider) as unknown as { balanceOf(a: string): Promise<bigint> };

// what the example buy (payToken -> XTZ, exact-out sized to cover the price) will spend
const buyTarget = targetForMinOut(BigInt(PRICE_MUTEZ), SLIPPAGE_BPS);
const buySwap = await freeRoute.getSwap({ src: payToken.address, dst: XTZ.address, amount: toEvm(buyTarget, XTZ.address), isExactOut: true, from: aliasAddress, receiver: aliasAddress, slippageBps: SLIPPAGE_BPS });
const needed = buySwap.srcAmount; // pay-token units the example will spend
const have = await erc20.balanceOf(aliasAddress);
console.log(`alias ${PAY}: have ${have} · need ${needed} for this buy`);

if (have < needed) {
  const fundMutez = BigInt(Math.round(FUND_XTZ * 1e6));
  // fund = XTZ -> payToken (exact-in), output stays on the alias as ERC20
  const fundSwap = await freeRoute.getSwap({ src: XTZ.address, dst: payToken.address, amount: toEvm(fundMutez, XTZ.address), from: aliasAddress, receiver: aliasAddress, slippageBps: 300 });
  const fundOps = freeRoute.buildSwapOperation({ swap: fundSwap, srcAddress: XTZ.address });
  console.log(`fund: swap ${FUND_XTZ} XTZ -> ~${fundSwap.dstAmount} ${PAY} units (router ${fundSwap.tx.to})`);
  await sendGroup(buyer, fundOps);
  await new Promise((r) => setTimeout(r, 4000));
  console.log(`alias ${PAY} now = ${await erc20.balanceOf(aliasAddress)}`);
} else {
  console.log(`alias already funded — skip`);
}

console.log(`\n✅ ready. Run the example:\n   ASK_ID=${askId} PRICE_XTZ=${PRICE_XTZ} PAY=${PAY} npm run example`);
