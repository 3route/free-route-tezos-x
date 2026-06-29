// scripts/shared/setup.ts — bootstrap a runnable demo (and the e2e fixtures-per-run):
//   1. mint a fresh test NFT on TEST_FA2 (to the seller),
//   2. list it as an ask on the objkt v4 marketplace (priced in XTZ),
//   3. fund the buyer's EVM alias (and, if asked, an EVM account) with the pay-token (swap some of the buyer's XTZ).
//
// `runSetup(...)` is the reusable flow (shared with the e2e suite); the bottom is the CLI wrapper that reads .env
// and prints the ready buy commands. Run:  [PAY_SYMBOL=USDC PRICE_XTZ=0.004] npm run setup
import { MichelsonMap, type TezosToolkit, UnitValue } from '@taquito/taquito';
import { XTZ, michelsonToEvmAlias, readErc20Balance, targetForMinOut, toEvmUnits } from '../../src/index.js';
import type { EvmAddress, FreeRouteToken, FreeRouteTezosX } from '../../src/index.js';
import { evmAddressFromEnv, findToken, newFreeRoute } from './client.js';
import { isMain, makeToolkit, noop, poll, type Log } from './ctx.js';
import { env, need } from './env.js';
import { sendGroup } from '../michelson/send.js';

export interface SetupResult {
  askId: string;
  tokenId: number;
  priceMutez: bigint;
  payToken: FreeRouteToken;
}

/** Mint a fresh NFT, list it as an XTZ-priced objkt ask, and fund the pay-token for the upcoming buy(s). */
export async function runSetup(args: {
  freeRoute: FreeRouteTezosX;
  buyer: TezosToolkit;
  seller: TezosToolkit;
  buyerAlias: EvmAddress;
  sellerAddress: string;
  evmRpc: string;
  fa2: string;
  objkt: string;
  paySymbol: string;
  priceXtz: number;
  slippageBps?: number;
  fundEvmAccount?: EvmAddress | null; // also fund this EVM account's pay-token (needs EVM_SK in env)
  tzktExplorer?: string;
  log?: Log;
}): Promise<SetupResult> {
  const { freeRoute, buyer, seller, buyerAlias, sellerAddress, evmRpc, fa2, objkt: marketplace, paySymbol, priceXtz } = args;
  const slippageBps = args.slippageBps ?? 200;
  const log = args.log ?? noop;
  const priceMutez = BigInt(Math.round(priceXtz * 1e6));

  const link = (hash: string) => (args.tzktExplorer ? log(`  ${args.tzktExplorer}/${hash}`) : undefined);
  // pure-Michelson calls: gas/storage estimate fine on previewnet, so we pin only fee.
  const confirm = async (op: { confirmation(): Promise<unknown>; hash: string }) => {
    await op.confirmation();
    link(op.hash);
  };

  // 1) MINT a fresh token to the seller. The FA2 assigns the id (next_token_id counter) — read it just before.
  const fa2c = await seller.contract.at(fa2);
  const tokenId = ((await fa2c.storage()) as { next_token_id: { toNumber(): number } }).next_token_id.toNumber();
  log(`mint token ${tokenId} -> seller`);
  await confirm(await fa2c.methodsObject.mint!(sellerAddress).send({ fee: 50_000 }));

  // objkt pulls the NFT from the seller on fulfill, so the marketplace must be an FA2 operator for this token.
  log(`approve objkt as operator for token ${tokenId}`);
  await confirm(await fa2c.methodsObject.update_operators!([{ add_operator: { owner: sellerAddress, operator: marketplace, token_id: tokenId } }]).send({ fee: 50_000 }));

  // 2) LIST the ask on objkt v4 (price in XTZ). ask id = current next_ask_id.
  const mp = await seller.contract.at(marketplace);
  const askId = String(((await mp.storage()) as { next_ask_id: { toNumber(): number } }).next_ask_id.toNumber());
  const shares = new MichelsonMap<string, number>(); // seller takes 100% (1000 / 1000)
  shares.set(sellerAddress, 1000);
  log(`list ask#${askId} · token ${tokenId} @ ${priceMutez} mutez (${priceXtz} XTZ)`);
  await confirm(await mp.methodsObject.ask!({
    token: { address: fa2, token_id: tokenId },
    currency: { tez: UnitValue }, // price in XTZ
    amount: priceMutez, // objkt names the price "amount"
    editions: 1,
    shares,
    start_time: null,
    expiry_time: null,
    referral_bonus: 0,
    condition: null,
  }).send({ fee: 200_000 }));

  // 3) FUND the pay-token for whoever will buy. Compute what a buy will spend (same route for either owner).
  const payToken = await findToken(freeRoute, paySymbol);
  const fmtPay = (x: bigint) => `${Number(x) / 10 ** payToken.decimals} ${paySymbol}`;
  const balanceOf = (owner: string) => readErc20Balance({ evmRpc, token: payToken.address, owner });

  const buyTarget = targetForMinOut(priceMutez, slippageBps);
  const buySwap = await freeRoute.getSwap({ src: payToken.address, dst: XTZ.address, amount: toEvmUnits(buyTarget, XTZ.address), isExactOut: true, from: buyerAlias, receiver: buyerAlias, slippageBps });
  const needed = buySwap.srcAmount;

  // top up the buyer's alias to ≥ needed pay-token, paid by the buyer (exact-out XTZ -> pay-token, receiver = alias)
  const have = await balanceOf(buyerAlias);
  log(`alias ${buyerAlias}: have ${fmtPay(have)} · need ${fmtPay(needed)}`);
  if (have < needed) {
    const fundSwap = await freeRoute.getSwap({ src: XTZ.address, dst: payToken.address, amount: needed * 2n - have, isExactOut: true, from: buyerAlias, receiver: buyerAlias, slippageBps: 300 });
    const hash = await sendGroup(buyer, freeRoute.michelson.buildSwapOperation({ swap: fundSwap, srcAddress: XTZ.address }));
    log(`  fund ${fmtPay(needed * 2n - have)} (router ${fundSwap.tx.to})`);
    link(hash);
    const now = await poll(() => balanceOf(buyerAlias), needed);
    if (now < needed) throw new Error(`alias still short after funding (${fmtPay(now)} < ${fmtPay(needed)})`);
  }

  // if asked, also top up an EVM account's pay-token (EVM-signed; loaded lazily so a Michelson-only setup needs no EVM env).
  if (args.fundEvmAccount) {
    const { ensureEvmToken } = await import('../evm/fund.js');
    await ensureEvmToken(freeRoute, payToken, needed);
  }

  return { askId, tokenId, priceMutez, payToken };
}

// ── CLI ──
if (isMain(import.meta.url)) {
  const michelsonRpc = need('MICHELSON_RPC');
  const buyer = makeToolkit(michelsonRpc, need('BUYER_MICHELSON_SK'));
  const seller = makeToolkit(michelsonRpc, need('SELLER_MICHELSON_SK'));
  const buyerAddress = await buyer.signer.publicKeyHash();
  const sellerAddress = await seller.signer.publicKeyHash();
  const buyerAlias = michelsonToEvmAlias(buyerAddress);
  const evmAccount = evmAddressFromEnv();
  const paySymbol = env.PAY_SYMBOL ?? 'USDC';
  console.log(`buyer ${buyerAddress} (alias ${buyerAlias}) · seller ${sellerAddress}`);

  const r = await runSetup({
    freeRoute: newFreeRoute(),
    buyer,
    seller,
    buyerAlias,
    sellerAddress,
    evmRpc: need('EVM_RPC'),
    fa2: need('TEST_FA2'),
    objkt: need('OBJKT_MARKETPLACE'),
    paySymbol,
    priceXtz: Number(env.PRICE_XTZ ?? 0.004),
    fundEvmAccount: evmAccount,
    tzktExplorer: need('TZKT_EXPLORER'),
    log: console.log,
  });

  console.log(`\n✅ ready. Buy the ask:`);
  console.log(`   Michelson (Temple):  ASK_ID=${r.askId} PAY_SYMBOL=${paySymbol} npm run example-buy:michelson`);
  if (evmAccount) console.log(`   EVM (MetaMask):      ASK_ID=${r.askId} PAY_SYMBOL=${paySymbol} npm run example-buy:evm`);
  else console.log(`   EVM (MetaMask):      set EVM_SK (with gas XTZ on its 0x) and re-run setup to auto-fund ${paySymbol}, then npm run example-buy:evm`);
}
