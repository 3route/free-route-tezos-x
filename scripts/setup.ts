// scripts/setup.ts — bootstrap a runnable demo from scratch:
//   1. mint a fresh test NFT on TEST_FA2 (to the seller),
//   2. list it as an ask on the objkt v4 marketplace (priced in XTZ),
//   3. fund the buyer's EVM alias with the pay-token (swap some of the buyer's XTZ) to 2x the buy's need.
// Then prints the ready `npm run example-buy` command (with ASK_ID / PAY_SYMBOL).
// Config comes from .env; [PAY_SYMBOL / PRICE_XTZ] are optional per-run overrides.
// Run:  [PAY_SYMBOL=USDC PRICE_XTZ=0.004] npx tsx scripts/setup.ts
import { MichelsonMap, RpcForger, TezosToolkit, UnitValue } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import { FreeRouteTezosX, XTZ, michelsonToEvmAlias, readErc20Balance, targetForMinOut, tezosXPreviewnet, toEvm } from '../src/index.js';
import { need } from './env.js';
import { sendGroup } from './send.js';

const MICHELSON_RPC = need('MICHELSON_RPC');
const EVM_RPC = need('EVM_RPC');
const FREE_ROUTE_API = need('FREE_ROUTE_API');
const OBJKT_MARKETPLACE = need('OBJKT_MARKETPLACE');
const TEST_FA2 = need('TEST_FA2');
const TZKT_EXPLORER = need('TZKT_EXPLORER');

const PAY_SYMBOL = process.env.PAY_SYMBOL ?? 'USDC';
const PRICE_XTZ = Number(process.env.PRICE_XTZ ?? 0.004);
const SLIPPAGE_BPS = 200; // 2%
const PRICE_MUTEZ = Math.round(PRICE_XTZ * 1e6);

const makeToolkit = (sk: string): TezosToolkit => {
  const tk = new TezosToolkit(MICHELSON_RPC);
  tk.setProvider({ signer: new InMemorySigner(sk) });
  tk.setForgerProvider(tk.getFactory(RpcForger)()); // previewnet rejects local forging
  return tk;
};

// confirm a sent op and print its explorer link
const sendOp = async (op: { confirmation(): Promise<unknown>; hash: string }) => {
  await op.confirmation();
  console.log(`  ${TZKT_EXPLORER}/${op.hash}`);
};

const buyer = makeToolkit(need('BUYER_MICHELSON_SK'));
const seller = makeToolkit(need('SELLER_MICHELSON_SK'));
const buyerMichelsonAddress = await buyer.signer.publicKeyHash();
const sellerMichelsonAddress = await seller.signer.publicKeyHash(); // == update_operators owner, so must be the signer
const aliasAddress = michelsonToEvmAlias(buyerMichelsonAddress);
const freeRoute = new FreeRouteTezosX({ network: tezosXPreviewnet, baseUrl: FREE_ROUTE_API });
console.log(`buyer ${buyerMichelsonAddress} (alias ${aliasAddress}) · seller ${sellerMichelsonAddress}`);

// The three ops below are pure-Michelson calls: gas/storage estimate fine on previewnet, so we pin only fee
// (the EVM-node fee policy is the one thing stricter than Taquito's estimate).

// 1) MINT a fresh token to the seller. The FA2 assigns the id itself (next_token_id counter), so
//    we read it just before minting — no client-side id, no collisions. mint takes only the owner.
const fa2 = await seller.contract.at(TEST_FA2);
const TOKEN_ID = ((await fa2.storage()) as { next_token_id: { toNumber(): number } }).next_token_id.toNumber();
console.log(`mint token ${TOKEN_ID} -> seller`);
await sendOp(await fa2.methodsObject.mint!(sellerMichelsonAddress).send({ fee: 50_000 }));

// objkt pulls the NFT from the seller on fulfill, so the marketplace must be an FA2 operator for this token.
console.log(`approve objkt as operator for token ${TOKEN_ID}`);
await sendOp(await fa2.methodsObject.update_operators!([{ add_operator: { owner: sellerMichelsonAddress, operator: OBJKT_MARKETPLACE, token_id: TOKEN_ID } }]).send({ fee: 50_000 }));

// 2) LIST the ask on objkt v4 (price in XTZ). ask id = current next_ask_id.
const marketplace = await seller.contract.at(OBJKT_MARKETPLACE);
const askId = ((await marketplace.storage()) as { next_ask_id: { toNumber(): number } }).next_ask_id.toNumber();
const shares = new MichelsonMap<string, number>(); // seller takes 100% (1000 / 1000)
shares.set(sellerMichelsonAddress, 1000);
console.log(`list ask#${askId} · token ${TOKEN_ID} @ ${PRICE_MUTEZ} mutez (${PRICE_XTZ} XTZ)`);
await sendOp(await marketplace.methodsObject.ask!({
  token: { address: TEST_FA2, token_id: TOKEN_ID },
  currency: { tez: UnitValue }, // price in XTZ (vs %fa12 / %fa2 currencies)
  amount: PRICE_MUTEZ, // objkt names the price "amount"
  editions: 1,
  shares,
  start_time: null,
  expiry_time: null,
  referral_bonus: 0,
  condition: null,
}).send({ fee: 200_000 }));

// 3) FUND the alias with the pay-token if it's short. Needed amount = the example's exact-out buy input.
const payToken = (await freeRoute.getTokens()).find((t) => t.symbol === PAY_SYMBOL);
if (!payToken) throw new Error(`pay-token ${PAY_SYMBOL} not in the free-route registry`);
const balanceOf = () => readErc20Balance({ evmRpc: EVM_RPC, token: payToken.address, owner: aliasAddress });
const fmtPay = (x: bigint) => `${Number(x) / 10 ** payToken.decimals} ${PAY_SYMBOL}`; // base units -> human-readable

// The alias ERC20 balance settles on the EVM side shortly after the Tezos confirmation — poll up to ~15s
// for it to reach `min` (returns early once it does), instead of a fixed sleep.
const pollBalance = async (min: bigint, tries = 15): Promise<bigint> => {
  let bal = await balanceOf();
  for (let i = 0; i < tries && bal < min; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    bal = await balanceOf();
  }
  return bal;
};

// what the example buy (payToken -> XTZ, exact-out sized to cover the price) will spend
const buyTarget = targetForMinOut(BigInt(PRICE_MUTEZ), SLIPPAGE_BPS);
const buySwap = await freeRoute.getSwap({ src: payToken.address, dst: XTZ.address, amount: toEvm(buyTarget, XTZ.address), isExactOut: true, from: aliasAddress, receiver: aliasAddress, slippageBps: SLIPPAGE_BPS });
const needed = buySwap.srcAmount; // pay-token units the example will spend
const have = await balanceOf();
console.log(`alias: have ${fmtPay(have)} · need ${fmtPay(needed)} for this buy`);

if (have < needed) {
  const target = needed * 2n; // top up to 2x the estimate — margin for price drift + the buy's fresh re-quote
  // exact-out: request (target - have) pay-token onto the alias (actual ≥ floor after slippage), paid in the buyer's XTZ
  const fundSwap = await freeRoute.getSwap({ src: XTZ.address, dst: payToken.address, amount: target - have, isExactOut: true, from: aliasAddress, receiver: aliasAddress, slippageBps: 300 });
  const fundOps = freeRoute.buildSwapOperation({ swap: fundSwap, srcAddress: XTZ.address });
  console.log(`fund: request ${fmtPay(target - have)} onto the alias (router ${fundSwap.tx.to})`);
  console.log(`  ${TZKT_EXPLORER}/${await sendGroup(buyer, fundOps)}`);
  const now = await pollBalance(needed);
  console.log(`alias now = ${fmtPay(now)}`);
  if (now < needed) throw new Error(`alias still short after funding (${fmtPay(now)} < ${fmtPay(needed)})`);
} else {
  console.log(`alias already funded — skip`);
}

console.log(`\n✅ ready. Run the example:\n   ASK_ID=${askId} PAY_SYMBOL=${PAY_SYMBOL} npm run example-buy`);
