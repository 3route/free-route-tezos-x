// scripts/evm/example-buy.ts — MetaMask-style buy: an EVM account pays an ERC20 for an XTZ-priced objkt NFT.
// Mirror of the Michelson example-buy, but every call is native EVM: approve + swap (raw /swap tx) + fulfill via
// the gateway's callMichelson (msg.value funds the buy; the NFT lands on the EVM account's KT1 alias). Same
// allowance-aware approval flow (resolveApproval picks skip / approve / reset+approve).
//
// `buyEvm(...)` is the reusable flow (shared with the e2e suite); the bottom is the CLI wrapper.
// Prereq: the EVM account holds PAY_SYMBOL (run `npm run bridge:evm` / `setup`) + native XTZ for gas.
// Run:  ASK_ID=2 PAY_SYMBOL=USDC npm run example-buy:evm
import { XTZ, evmToMichelsonAlias, fromEvmUnits, objkt, resolveApproval, targetForMinOut, toEvmUnits } from '../../src/index.js';
import type { EvmAddress, FreeRouteTezosX } from '../../src/index.js';
import { findToken, newFreeRoute, readAskPrice } from '../shared/client.js';
import { isMain, noop, type Log } from '../shared/ctx.js';
import { env, need } from '../shared/env.js';
import { evmAccount, sendSequential } from './send.js';

export interface EvmBuyResult {
  hashes: string[];
  priceMutez: bigint;
  srcAmount: bigint;
  paySymbol: string;
  expectedOwner: string; // KT1 alias of the EVM account, or the recipient
}

/** Pay an ERC20 for an XTZ-priced objkt ask from a native EVM account (approve + swap + callMichelson fulfill). */
export async function buyEvm(args: {
  freeRoute: FreeRouteTezosX;
  evmAccount: EvmAddress; // the native 0x that signs + pays
  michelsonRpc: string; // to read the ask price on-chain
  evmRpc: string; // to read the ERC20 allowance
  objkt: string;
  askId: string;
  paySymbol: string;
  recipient?: string | null; // optional objkt v4 %proxy_for; default = the account's KT1 alias
  slippageBps?: number;
  evmExplorer?: string;
  log?: Log;
}): Promise<EvmBuyResult> {
  const { freeRoute, evmAccount: from, michelsonRpc, evmRpc, objkt: marketplace, askId, paySymbol } = args;
  const recipient = args.recipient ?? undefined;
  const slippageBps = args.slippageBps ?? 200;
  const log = args.log ?? noop;

  const alias = evmToMichelsonAlias(from); // the KT1 where the NFT lands by default
  const payToken = await findToken(freeRoute, paySymbol);
  const fmtPay = (x: bigint) => `${Number(x) / 10 ** payToken.decimals} ${paySymbol}`;
  const priceMutez = await readAskPrice(michelsonRpc, marketplace, askId);

  // 1. swap: exact-out payToken -> native XTZ to the EVM account, sized so the on-chain floor covers the price.
  const swap = await freeRoute.getSwap({
    src: payToken.address,
    dst: XTZ.address,
    amount: toEvmUnits(targetForMinOut(priceMutez, slippageBps), XTZ.address),
    isExactOut: true,
    from,
    receiver: from,
    slippageBps,
  });

  // 2. read the on-chain allowance (account -> router) -> pick the minimal safe approval mode.
  const approval = await resolveApproval({ evmRpc, token: payToken.address, owner: from, spender: swap.tx.to, amount: swap.srcAmount });
  const swapTxs = freeRoute.evm.buildSwapTransaction({ swap, srcAddress: payToken.address, approval });

  // 3. fulfill the ask from the EVM side (callMichelson; the swapped XTZ funds msg.value; NFT -> alias/recipient).
  const fulfillTx = objkt.buildEvmFulfillAskTransaction({ marketplace, askId, editions: 1, amountMutez: priceMutez, recipient });
  const batch = [...swapTxs, fulfillTx];

  const expectedOwner = recipient ?? alias;
  log(`buyer ${from} · pay ≤ ${fmtPay(swap.srcAmount)} · receive ≥ ${fromEvmUnits(swap.dstAmountMin, XTZ.address)} mutez · ask#${askId} = ${Number(priceMutez) / 1e6} XTZ · approval='${approval}'`);
  log(`EVM batch — ${batch.length} tx, sent sequentially (a dApp sends them atomically via wallet_sendCalls/EIP-5792) · NFT → ${expectedOwner}`);
  const hashes = await sendSequential(batch, args.evmExplorer);
  return { hashes, priceMutez, srcAmount: swap.srcAmount, paySymbol, expectedOwner };
}

// ── CLI ──
if (isMain(import.meta.url)) {
  const r = await buyEvm({
    freeRoute: newFreeRoute(),
    evmAccount: evmAccount().address,
    michelsonRpc: need('MICHELSON_RPC'),
    evmRpc: need('EVM_RPC'),
    objkt: need('OBJKT_MARKETPLACE'),
    askId: need('ASK_ID'),
    paySymbol: env.PAY_SYMBOL ?? 'USDC',
    recipient: env.NFT_RECIPIENT,
    evmExplorer: need('EVM_EXPLORER'),
    log: console.log,
  });
  console.log(`\n✅ done — ${r.hashes.length} tx confirmed, NFT → ${r.expectedOwner}`);
}
