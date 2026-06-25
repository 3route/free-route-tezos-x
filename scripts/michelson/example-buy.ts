// scripts/michelson/example-buy.ts — minimal headless buy: pay an EVM ERC20 for an XTZ-priced objkt NFT, signed with
// the buyer key from .env (InMemorySigner — no Beacon/Temple wallet). Config comes from .env; ASK_ID /
// PAY_SYMBOL are the per-run knobs (the exact line scripts/setup.ts prints); the price is read from the ask.
// Demonstrates the allowance-aware approval flow: swap (price+route+calldata) -> resolveApproval reads the on-chain allowance and picks
// the safe & minimal mode (skip / approve / reset+approve) -> build the ops. One atomic op-group ending in
// fulfill_ask. Run:  ASK_ID=2 PAY_SYMBOL=USDC npm run example-buy:michelson
import { InMemorySigner } from '@taquito/signer';
import { RpcForger, TezosToolkit } from '@taquito/taquito';
import {
  XTZ,
  FreeRouteTezosX,
  buildBatchTransaction,
  fromEvmUnits,
  michelsonToEvmAlias,
  objkt,
  resolveApproval,
  targetForMinOut,
  toEvmUnits,
  tezosXPreviewnet,
} from '../../src/index.js';
import { env, need } from '../shared/env.js';
import { sendGroup } from './send.js';

// ── config from env (.env + CLI). ASK_ID / PAY_SYMBOL are the per-run knobs setup.ts prints. ──
const MICHELSON_RPC = need('MICHELSON_RPC');
const EVM_RPC = need('EVM_RPC'); // to read the ERC20 allowance
const NETWORK = tezosXPreviewnet; // chainId + gateway

const OBJKT_MARKETPLACE = need('OBJKT_MARKETPLACE'); // objkt v4 marketplace
const ASK_ID = need('ASK_ID'); // required — guards against buying a stale ask
const PAY_SYMBOL = env.PAY_SYMBOL ?? 'USDC'; // ERC20 to pay with (held on the buyer's alias)
const SLIPPAGE_BPS = 200; // 2%
// ──────────────────────────────────────────────────────────────────────────────────────────────

const tezos = new TezosToolkit(MICHELSON_RPC);
tezos.setProvider({ signer: new InMemorySigner(need('BUYER_MICHELSON_SK')) });
tezos.setForgerProvider(tezos.getFactory(RpcForger)()); // previewnet rejects local forging
// The free-route server needs an api key. This script runs in Node (server-side), so the key
// goes straight on the client. Set FREE_ROUTE_API_KEY='YourApiKey' in .env.
const freeRoute = new FreeRouteTezosX({
    network: NETWORK,
    baseUrl: need('FREE_ROUTE_API'),
    apiKey: need('FREE_ROUTE_API_KEY'),
});

const buyerMichelsonAddress = await tezos.signer.publicKeyHash();
const buyerAlias = michelsonToEvmAlias(buyerMichelsonAddress); // the EVM-side identity that holds the ERC20 / runs the swap
const payToken = (await freeRoute.getTokens()).find((t) => t.symbol === PAY_SYMBOL);
if (!payToken) throw new Error(`pay token ${PAY_SYMBOL} not in the free-route registry`);
const fmtPay = (x: bigint) => `${Number(x) / 10 ** payToken.decimals} ${PAY_SYMBOL}`; // base units -> human-readable
const fmtXtz = (mutez: bigint | number) => `${mutez} mutez (${Number(mutez) / 1e6} XTZ)`;

// read the ask's price on-chain (mutez) — the single source of truth, no CLI price to keep in sync.
const marketplace = await tezos.contract.at(OBJKT_MARKETPLACE);
const ask = await ((await marketplace.storage()) as { asks: { get(id: string): Promise<{ amount: { toString(): string } } | undefined> } }).asks.get(ASK_ID);
if (!ask) throw new Error(`ask #${ASK_ID} not found (already sold, or wrong OBJKT_MARKETPLACE)`);
const priceMutez = BigInt(ask.amount.toString());

// 1. swap: exact-out payToken -> XTZ, sized so the on-chain floor still covers the ask price.
const minOutTarget = targetForMinOut(priceMutez, SLIPPAGE_BPS);
const swapAmount = toEvmUnits(minOutTarget, XTZ.address); // mutez -> wei for the EVM API
const swap = await freeRoute.getSwap({
  src: payToken.address,
  dst: XTZ.address,
  amount: swapAmount,
  isExactOut: true,
  from: buyerAlias,
  receiver: buyerAlias,
  slippageBps: SLIPPAGE_BPS,
});
const srcAmount = swap.srcAmount; // payToken the swap will pull
const router = swap.tx.to;

// 2. read the on-chain allowance (alias -> router) -> pick the minimal safe approval mode (none / approve / reset+approve)
const approval = await resolveApproval({
  evmRpc: EVM_RPC,
  token: payToken.address,
  owner: buyerAlias,
  spender: router,
  amount: srcAmount,
});
console.log(`buyer ${buyerMichelsonAddress} · pay ≤ ${fmtPay(srcAmount)} · receive ≥ ${fmtXtz(fromEvmUnits(swap.dstAmountMin, XTZ.address))} · router ${router}`);
console.log(`need ${fmtPay(srcAmount)} → approval='${approval}'`);

// 3. build the swap ops for that mode, compose with the marketplace fulfill, sign once.
const swapOps = freeRoute.michelson.buildSwapOperation({ swap, srcAddress: payToken.address, approval });
const fulfillOp = objkt.buildFulfillAsk({ marketplace: OBJKT_MARKETPLACE, askId: ASK_ID, editions: 1, amountMutez: priceMutez });
const group = buildBatchTransaction(swapOps, fulfillOp);

// describe each op in the atomic group. Order matches `group`:
// [reset?] [approve?] swap fulfill_ask — the approve(s) depend on the chosen allowance mode.
const approveSteps =
  approval === 'resetThenApprove'
    ? [`approve (call_evm) — reset ${PAY_SYMBOL} allowance to 0 (safe re-approval)`, `approve (call_evm) — approve ${fmtPay(srcAmount)} to the router`]
    : approval === 'approve'
      ? [`approve (call_evm) — approve ${fmtPay(srcAmount)} to the router`]
      : []; // 'none' — existing allowance already covers it
const steps = [
  ...approveSteps,
  `swap (call_evm) — ${fmtPay(srcAmount)} → ≥ ${fmtXtz(fromEvmUnits(swap.dstAmountMin, XTZ.address))} native XTZ on alias ${buyerAlias}, auto-forwarded to ${buyerMichelsonAddress}`,
  `fulfill_ask — buy ask#${ASK_ID} for ${Number(priceMutez) / 1e6} XTZ`,
];
console.log(`atomic group — ${group.length} ops, one signature:`);
steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));

const hash = await sendGroup(tezos, group);
console.log(`Done: ${need('TZKT_EXPLORER')}/${hash}`);
