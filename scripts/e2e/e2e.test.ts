// scripts/e2e/e2e.test.ts — integration tests against the live Tezos X previewnet gateway. Reuses the exact
// flow functions the demo CLI scripts run (runSetup / buyMichelson / buyEvm / bridgeMichelson / bridgeEvm),
// then asserts the on-chain outcome (NFT ownership, ERC20 received). Run: `npm run test:e2e`.
//
// MUST run sequentially: the assertions measure balance deltas on shared accounts (the buyer alias / EVM
// account), so two cases touching the same account concurrently would corrupt each other's delta. node:test
// runs top-level tests in a single file serially (no `concurrency`), and CI serializes whole runs — keep it so.
//
// Prerequisites (one-time, via .env / CI secrets): MICHELSON_RPC, EVM_RPC, FREE_ROUTE_API[_KEY], TZKT/EVM
// explorers, BUYER/SELLER Michelson keys + EVM_SK (all funded with previewnet XTZ via the faucet), and the
// deployed TEST_FA2 + OBJKT_MARKETPLACE. `buildCtx()` fails fast (via `need`) if any is missing.
import { before, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { evmToMichelsonAlias, readErc20Balance } from '../../src/index.js';
import type { EvmAddress } from '../../src/index.js';
import { buildCtx, type Ctx } from '../shared/ctx.js';
import { runSetup } from '../shared/setup.js';
import { buyMichelson } from '../michelson/example-buy.js';
import { buyEvm } from '../evm/example-buy.js';
import { bridgeMichelson } from '../michelson/bridge.js';
import { bridgeEvm } from '../evm/bridge.js';
import { publicClient } from '../evm/send.js';
import { assertNftOwner, assertReceived } from './assert.js';

const PAY = 'USDC';
const PRICE_XTZ = 0.004;
const MIN_TZ1_MUTEZ = 2_000_000n; // ~2 XTZ headroom for several flows
const MIN_EVM_WEI = 1_000_000_000_000_000_000n; // ~1 XTZ gas

let ctx: Ctx;

// fresh ask per case (mint + list + fund) — read ctx at call time (set in before()).
const setup = (fundEvmAccount: EvmAddress | null) =>
  runSetup({
    freeRoute: ctx.freeRoute,
    buyer: ctx.buyer,
    seller: ctx.seller,
    buyerAlias: ctx.buyerAlias,
    sellerAddress: ctx.sellerAddress,
    evmRpc: ctx.evmRpc,
    fa2: ctx.fa2,
    objkt: ctx.objkt,
    paySymbol: PAY,
    priceXtz: PRICE_XTZ,
    fundEvmAccount,
  });

before(async () => {
  ctx = await buildCtx();
  await ctx.freeRoute.getTokens(); // free-route reachable

  // XTZ-funded prerequisites (faucet) — fail fast with the address to top up.
  const buyerXtz = BigInt((await ctx.buyer.tz.getBalance(ctx.buyerAddress)).toString());
  const sellerXtz = BigInt((await ctx.seller.tz.getBalance(ctx.sellerAddress)).toString());
  const evmXtz = await publicClient.getBalance({ address: ctx.evmAccount as `0x${string}` });
  assert.ok(buyerXtz >= MIN_TZ1_MUTEZ, `buyer ${ctx.buyerAddress} needs ≥2 XTZ (previewnet faucet)`);
  assert.ok(sellerXtz >= MIN_TZ1_MUTEZ, `seller ${ctx.sellerAddress} needs ≥2 XTZ (previewnet faucet)`);
  assert.ok(evmXtz >= MIN_EVM_WEI, `EVM account ${ctx.evmAccount} needs ≥1 XTZ gas (previewnet faucet)`);
});

test('michelson buy — NFT lands on the buyer tz1', async () => {
  const s = await setup(null);
  const r = await buyMichelson({
    freeRoute: ctx.freeRoute,
    buyer: ctx.buyer,
    buyerAddress: ctx.buyerAddress,
    buyerAlias: ctx.buyerAlias,
    michelsonRpc: ctx.michelsonRpc,
    evmRpc: ctx.evmRpc,
    objkt: ctx.objkt,
    askId: s.askId,
    paySymbol: PAY,
  });
  await assertNftOwner(ctx.buyer, ctx.fa2, s.tokenId, ctx.buyerAddress);
  assert.ok(r.srcAmount > 0n, 'paid some pay-token');
});

test('michelson buy — recipient redirects the NFT (objkt proxy_for)', async () => {
  const recipient = evmToMichelsonAlias(ctx.evmAccount); // a KT1 distinct from the buyer tz1
  const s = await setup(null);
  await buyMichelson({
    freeRoute: ctx.freeRoute,
    buyer: ctx.buyer,
    buyerAddress: ctx.buyerAddress,
    buyerAlias: ctx.buyerAlias,
    michelsonRpc: ctx.michelsonRpc,
    evmRpc: ctx.evmRpc,
    objkt: ctx.objkt,
    askId: s.askId,
    paySymbol: PAY,
    recipient,
  });
  await assertNftOwner(ctx.buyer, ctx.fa2, s.tokenId, recipient);
});

test('evm buy — NFT lands on the account KT1 alias', async () => {
  const s = await setup(ctx.evmAccount); // also funds the EVM account's pay-token
  const r = await buyEvm({
    freeRoute: ctx.freeRoute,
    evmAccount: ctx.evmAccount,
    michelsonRpc: ctx.michelsonRpc,
    evmRpc: ctx.evmRpc,
    objkt: ctx.objkt,
    askId: s.askId,
    paySymbol: PAY,
  });
  await assertNftOwner(ctx.buyer, ctx.fa2, s.tokenId, evmToMichelsonAlias(ctx.evmAccount));
  assert.ok(r.hashes.length >= 1, 'sent the EVM batch');
});

test('evm buy — recipient redirects the NFT (objkt proxy_for)', async () => {
  const recipient = ctx.buyerAddress; // a tz1 distinct from the account's default KT1 alias
  const s = await setup(ctx.evmAccount);
  await buyEvm({
    freeRoute: ctx.freeRoute,
    evmAccount: ctx.evmAccount,
    michelsonRpc: ctx.michelsonRpc,
    evmRpc: ctx.evmRpc,
    objkt: ctx.objkt,
    askId: s.askId,
    paySymbol: PAY,
    recipient,
  });
  await assertNftOwner(ctx.buyer, ctx.fa2, s.tokenId, recipient);
});

test('michelson bridge — XTZ → USDC onto the buyer alias', async () => {
  const usdc = await ctx.freeRoute.getTokens().then((ts) => ts.find((t) => t.symbol === PAY)!);
  const before = await readErc20Balance({ evmRpc: ctx.evmRpc, token: usdc.address, owner: ctx.buyerAlias });
  const r = await bridgeMichelson({
    freeRoute: ctx.freeRoute,
    buyer: ctx.buyer,
    buyerAddress: ctx.buyerAddress,
    buyerAlias: ctx.buyerAlias,
    srcSymbol: 'XTZ',
    dstSymbol: PAY,
    inAmount: 0.05,
  });
  await assertReceived(ctx.evmRpc, usdc.address, ctx.buyerAlias, before, r.minOut);
});

test('evm bridge — XTZ → USDC onto the EVM account', async () => {
  const usdc = await ctx.freeRoute.getTokens().then((ts) => ts.find((t) => t.symbol === PAY)!);
  const before = await readErc20Balance({ evmRpc: ctx.evmRpc, token: usdc.address, owner: ctx.evmAccount });
  const r = await bridgeEvm({
    freeRoute: ctx.freeRoute,
    evmAccount: ctx.evmAccount,
    srcSymbol: 'XTZ',
    dstSymbol: PAY,
    inAmount: 0.05,
  });
  await assertReceived(ctx.evmRpc, usdc.address, ctx.evmAccount, before, r.minOut);
});

test('michelson bridge — receiver redirects the output (XTZ → USDC to the EVM account)', async () => {
  const usdc = await ctx.freeRoute.getTokens().then((ts) => ts.find((t) => t.symbol === PAY)!);
  const receiver = ctx.evmAccount; // a 0x distinct from the swapper's default alias
  const before = await readErc20Balance({ evmRpc: ctx.evmRpc, token: usdc.address, owner: receiver });
  const r = await bridgeMichelson({
    freeRoute: ctx.freeRoute,
    buyer: ctx.buyer,
    buyerAddress: ctx.buyerAddress,
    buyerAlias: ctx.buyerAlias,
    srcSymbol: 'XTZ',
    dstSymbol: PAY,
    inAmount: 0.05,
    receiver,
  });
  await assertReceived(ctx.evmRpc, usdc.address, receiver, before, r.minOut);
});

test('evm bridge — receiver redirects the output (XTZ → USDC to the buyer alias)', async () => {
  const usdc = await ctx.freeRoute.getTokens().then((ts) => ts.find((t) => t.symbol === PAY)!);
  const receiver = ctx.buyerAlias; // a 0x distinct from the EVM account itself
  const before = await readErc20Balance({ evmRpc: ctx.evmRpc, token: usdc.address, owner: receiver });
  const r = await bridgeEvm({
    freeRoute: ctx.freeRoute,
    evmAccount: ctx.evmAccount,
    srcSymbol: 'XTZ',
    dstSymbol: PAY,
    inAmount: 0.05,
    receiver,
  });
  await assertReceived(ctx.evmRpc, usdc.address, receiver, before, r.minOut);
});
