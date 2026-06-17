// scripts/example-buy.ts — minimal headless buy: pay an EVM ERC20 for an XTZ-priced objkt NFT, signed with
// the buyer key from .env (InMemorySigner — no Beacon/Temple wallet). Config comes from .env; ASK_ID /
// PRICE_XTZ / PAY are the per-run knobs (the exact line scripts/setup.ts prints).
// Demonstrates the allowance-aware approval flow: swap (price+route+calldata) -> resolveApproval reads the on-chain allowance and picks
// the safe & minimal mode (skip / approve / reset+approve) -> build the ops. One atomic op-group ending in
// fulfill_ask. Run:  ASK_ID=2 PRICE_XTZ=0.004 PAY=USDC npm run example
import { InMemorySigner } from '@taquito/signer';
import { RpcForger, TezosToolkit } from '@taquito/taquito';
import {
  XTZ,
  ThreeRouteTezosX,
  buildBatchTransaction,
  buildSwapOperation,
  fromEvm,
  michelsonToEvmAlias,
  objkt,
  resolveApproval,
  targetForMinOut,
  toEvm,
  tezosXPreviewnet,
} from '../src/index.js';
import { env, need } from './env.js';
import { sendGroup } from './send.js';

// ── config from env (.env + CLI). ASK_ID / PRICE_XTZ / PAY are the per-run knobs setup.ts prints. ──
const MICHELSON_RPC = need('MICHELSON_RPC');
const EVM_RPC = need('EVM_RPC'); // to read the ERC20 allowance
const NETWORK = tezosXPreviewnet; // chainId + gateway

const MARKETPLACE = need('OBJKT_MARKETPLACE'); // objkt v4 marketplace
const ASK_ID = need('ASK_ID'); // required — guards against buying a stale ask
const PRICE_MUTEZ = BigInt(Math.round(Number(need('PRICE_XTZ')) * 1e6)); // must match the ask price
const PAY_SYMBOL = env.PAY ?? 'USDC'; // ERC20 to pay with (held on the buyer's alias)
const SLIPPAGE_BPS = 200; // 2%
// ──────────────────────────────────────────────────────────────────────────────────────────────

const tezos = new TezosToolkit(MICHELSON_RPC);
tezos.setProvider({ signer: new InMemorySigner(need('BUYER_MICHELSON_SK')) });
tezos.setForgerProvider(tezos.getFactory(RpcForger)()); // previewnet rejects local forging
// A hosted 3route server needs an HTTP Basic api key; the local dev server is keyless. This script runs in Node
// (server-side), so the key goes straight on the client. Set THREE_ROUTE_API_KEY='YourApiKey', or omit for local.
const swapper = new ThreeRouteTezosX({
    network: NETWORK,
    baseUrl: need('THREE_ROUTE_API'),
    apiKey: env.THREE_ROUTE_API_KEY,
});

const account = await tezos.signer.publicKeyHash();
const alias = michelsonToEvmAlias(account); // the EVM-side identity that holds the ERC20 / runs the swap
const payToken = (await swapper.getTokens()).find((t) => t.symbol === PAY_SYMBOL);
if (!payToken) throw new Error(`pay token ${PAY_SYMBOL} not in the 3route registry`);

// 1. swap: exact-out payToken -> XTZ (price + route + calldata), sized so the on-chain floor covers the ask price.
const target = targetForMinOut(PRICE_MUTEZ, SLIPPAGE_BPS);
const swap = await swapper.client.getSwap({
  src: payToken.address,
  dst: XTZ.address,
  amount: toEvm(target, XTZ.address), // mutez -> wei for the EVM API
  exactOut: true,
  from: alias,
  receiver: alias,
  slippagePercent: SLIPPAGE_BPS / 100,
});
const srcAmount = swap.srcAmount; // payToken the swap will pull
const router = swap.tx.to;

// 2. let the SDK read the on-chain allowance (alias -> router) and pick the safe & minimal approval mode.
const approval = await resolveApproval({ evmRpc: EVM_RPC, token: payToken.address, owner: alias, spender: router, amount: srcAmount });
console.log(`buyer ${account} · pay ≤ ${srcAmount} ${PAY_SYMBOL} · receive ≥ ${fromEvm(swap.dstAmountMin, XTZ.address)} mutez · router ${router}`);
console.log(`need ${srcAmount} ${PAY_SYMBOL} → approval='${approval}'`);

// 3. build the swap ops for that mode, compose with the marketplace fulfill, sign once.
const swapOps = buildSwapOperation({ swap, gateway: NETWORK.gateway, srcAddress: payToken.address, approval });
const group = buildBatchTransaction(swapOps, objkt.buildFulfillAsk({ marketplace: MARKETPLACE, askId: ASK_ID, editions: 1, amountMutez: PRICE_MUTEZ }));
console.log(`Sending ${group.length}-op atomic group…`);
const hash = await sendGroup(tezos, group);
console.log(`Done: ${need('TZKT_EXPLORER')}/${hash}`);
