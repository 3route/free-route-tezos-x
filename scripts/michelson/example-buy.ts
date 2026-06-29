// scripts/michelson/example-buy.ts — minimal headless buy: pay an EVM ERC20 for an XTZ-priced objkt NFT, signed
// with an InMemorySigner (no Beacon/Temple). Demonstrates the allowance-aware approval flow: swap (price + route
// + calldata) -> resolveApproval reads the on-chain allowance and picks the safe & minimal mode (skip / approve /
// reset+approve) -> build the ops. One atomic op-group ending in fulfill_ask.
//
// `buyMichelson(...)` is the reusable flow (shared with the e2e suite); the bottom of this file is the CLI
// wrapper that reads .env and runs it. Run:  ASK_ID=2 PAY_SYMBOL=USDC npm run example-buy:michelson
import type { TezosToolkit } from '@taquito/taquito';
import {
  XTZ,
  buildBatchTransaction,
  fromEvmUnits,
  michelsonToEvmAlias,
  objkt,
  resolveApproval,
  targetForMinOut,
  toEvmUnits,
} from '../../src/index.js';
import type { EvmAddress, FreeRouteTezosX } from '../../src/index.js';
import { findToken, newFreeRoute, readAskPrice } from '../shared/client.js';
import { isMain, makeToolkit, noop, type Log } from '../shared/ctx.js';
import { env, need } from '../shared/env.js';
import { sendGroup } from './send.js';

export interface BuyResult {
  hash: string;
  priceMutez: bigint;
  srcAmount: bigint; // pay-token actually pulled by the swap
  paySymbol: string;
  expectedOwner: string; // who should own the NFT after the buy (recipient, or the buyer)
}

/** Pay an ERC20 for an XTZ-priced objkt ask, signed by `buyer` (one atomic Michelson op-group). */
export async function buyMichelson(args: {
  freeRoute: FreeRouteTezosX;
  buyer: TezosToolkit;
  buyerAddress: string;
  buyerAlias: EvmAddress;
  michelsonRpc: string;
  evmRpc: string; // to read the ERC20 allowance
  objkt: string; // marketplace KT1
  askId: string;
  paySymbol: string;
  recipient?: string | null; // optional: send the NFT to a DIFFERENT Michelson address (objkt v4 %proxy_for)
  slippageBps?: number;
  log?: Log;
}): Promise<BuyResult> {
  const { freeRoute, buyer, buyerAddress, buyerAlias, michelsonRpc, evmRpc, objkt: marketplace, askId, paySymbol } = args;
  const recipient = args.recipient ?? undefined;
  const slippageBps = args.slippageBps ?? 200;
  const log = args.log ?? noop;

  const payToken = await findToken(freeRoute, paySymbol);
  const fmtPay = (x: bigint) => `${Number(x) / 10 ** payToken.decimals} ${paySymbol}`;
  const fmtXtz = (mutez: bigint | number) => `${mutez} mutez (${Number(mutez) / 1e6} XTZ)`;

  // read the ask's price on-chain (mutez) — the single source of truth, no CLI price to keep in sync.
  const priceMutez = await readAskPrice(michelsonRpc, marketplace, askId);

  // 1. swap: exact-out payToken -> XTZ, sized so the on-chain floor still covers the ask price.
  const swap = await freeRoute.getSwap({
    src: payToken.address,
    dst: XTZ.address,
    amount: toEvmUnits(targetForMinOut(priceMutez, slippageBps), XTZ.address),
    isExactOut: true,
    from: buyerAlias,
    receiver: buyerAlias,
    slippageBps,
  });
  const srcAmount = swap.srcAmount;

  // 2. read the on-chain allowance (alias -> router) -> pick the minimal safe approval mode.
  const approval = await resolveApproval({ evmRpc, token: payToken.address, owner: buyerAlias, spender: swap.tx.to, amount: srcAmount });
  log(`buyer ${buyerAddress} · pay ≤ ${fmtPay(srcAmount)} · receive ≥ ${fmtXtz(fromEvmUnits(swap.dstAmountMin, XTZ.address))} · router ${swap.tx.to}`);
  log(`need ${fmtPay(srcAmount)} → approval='${approval}'`);

  // 3. build swap ops for that mode, compose with the marketplace fulfill, sign once.
  const swapOps = freeRoute.michelson.buildSwapOperation({ swap, srcAddress: payToken.address, approval });
  const fulfillOp = objkt.buildMichelsonFulfillAskOperation({ marketplace, askId, editions: 1, amountMutez: priceMutez, recipient });
  const group = buildBatchTransaction(swapOps, fulfillOp);

  const expectedOwner = recipient ?? buyerAddress;
  log(`atomic group — ${group.length} ops, one signature · NFT → ${expectedOwner}${recipient ? ' (proxy_for)' : ''}`);
  const hash = await sendGroup(buyer, group);
  return { hash, priceMutez, srcAmount, paySymbol, expectedOwner };
}

// ── CLI: ASK_ID / PAY_SYMBOL / NFT_RECIPIENT are the per-run knobs setup.ts prints. ──
if (isMain(import.meta.url)) {
  const michelsonRpc = need('MICHELSON_RPC');
  const buyer = makeToolkit(michelsonRpc, need('BUYER_MICHELSON_SK'));
  const buyerAddress = await buyer.signer.publicKeyHash();
  const r = await buyMichelson({
    freeRoute: newFreeRoute(),
    buyer,
    buyerAddress,
    buyerAlias: michelsonToEvmAlias(buyerAddress),
    michelsonRpc,
    evmRpc: need('EVM_RPC'),
    objkt: need('OBJKT_MARKETPLACE'),
    askId: need('ASK_ID'),
    paySymbol: env.PAY_SYMBOL ?? 'USDC',
    recipient: env.NFT_RECIPIENT,
    log: console.log,
  });
  console.log(`Done: ${need('TZKT_EXPLORER')}/${r.hash} · NFT → ${r.expectedOwner}`);
}
