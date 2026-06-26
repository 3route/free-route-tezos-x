// scripts/evm/example-buy.ts — MetaMask-style buy: an EVM account pays an ERC20 for an XTZ-priced objkt NFT.
// Mirror of the Michelson example-buy, but every call is native EVM: approve + swap (raw /swap tx) + fulfill
// via the gateway's callMichelson (msg.value funds the buy; the NFT lands on the EVM account's KT1 alias).
// Same allowance-aware approval flow (resolveApproval picks skip / approve / reset+approve).
// Prereq: the EVM account holds PAY_SYMBOL (run `npm run bridge:evm`) + native XTZ for gas.
// Run:  ASK_ID=2 PAY_SYMBOL=USDC npm run example-buy:evm
import { XTZ, evmToMichelsonAlias, fromEvmUnits, objkt, resolveApproval, targetForMinOut, toEvmUnits } from '../../src/index.js';
import { findToken, newFreeRoute, readAskPrice } from '../shared/client.js';
import { evmAccount, sendSequential } from './send.js';
import { env, need } from '../shared/env.js';

const MICHELSON_RPC = need('MICHELSON_RPC'); // to read the ask price on-chain
const EVM_RPC = need('EVM_RPC'); // to read the ERC20 allowance
const OBJKT_MARKETPLACE = need('OBJKT_MARKETPLACE');
const ASK_ID = need('ASK_ID'); // guards against buying a stale ask
const EVM_EXPLORER = need('EVM_EXPLORER');
const PAY_SYMBOL = env.PAY_SYMBOL ?? 'USDC';
const SLIPPAGE_BPS = 200; // 2%

const fr = newFreeRoute();
const from = evmAccount().address; // the native EVM account
const alias = evmToMichelsonAlias(from); // the KT1 where the NFT lands
const payToken = await findToken(fr, PAY_SYMBOL);
const fmtPay = (x: bigint) => `${Number(x) / 10 ** payToken.decimals} ${PAY_SYMBOL}`;
const fmtXtz = (mutez: bigint | number) => `${mutez} mutez (${Number(mutez) / 1e6} XTZ)`;

const priceMutez = await readAskPrice(MICHELSON_RPC, OBJKT_MARKETPLACE, ASK_ID);

// 1. swap: exact-out payToken -> native XTZ to the EVM account, sized so the on-chain floor covers the price.
const swap = await fr.getSwap({
  src: payToken.address,
  dst: XTZ.address,
  amount: toEvmUnits(targetForMinOut(priceMutez, SLIPPAGE_BPS), XTZ.address),
  isExactOut: true,
  from,
  receiver: from,
  slippageBps: SLIPPAGE_BPS,
});

// 2. read the on-chain allowance (account -> router) -> pick the minimal safe approval mode.
const approval = await resolveApproval({ evmRpc: EVM_RPC, token: payToken.address, owner: from, spender: swap.tx.to, amount: swap.srcAmount });
const swapTxs = fr.evm.buildSwapTransaction({ swap, srcAddress: payToken.address, approval }); // [reset?, approve, swapTx]

// 3. fulfill the ask from the EVM side (callMichelson; the swapped XTZ funds msg.value; NFT -> alias).
const fulfillTx = objkt.buildEvmFulfillAskTransaction({ marketplace: OBJKT_MARKETPLACE, askId: ASK_ID, editions: 1, amountMutez: priceMutez });

const batch = [...swapTxs, fulfillTx];

// describe each tx in the batch (order matches `batch`): [reset?] [approve?] swap fulfill_ask
const approveSteps =
  approval === 'resetThenApprove'
    ? [`approve — reset ${PAY_SYMBOL} allowance to 0 (safe re-approval)`, `approve — approve ${fmtPay(swap.srcAmount)} to the router`]
    : approval === 'approve'
      ? [`approve — approve ${fmtPay(swap.srcAmount)} to the router`]
      : []; // 'none' — existing allowance already covers it
const steps = [
  ...approveSteps,
  `swap — ${fmtPay(swap.srcAmount)} → ≥ ${fmtXtz(fromEvmUnits(swap.dstAmountMin, XTZ.address))} native XTZ on ${from} (funds the fulfill)`,
  `fulfill_ask (callMichelson) — buy ask#${ASK_ID} for ${Number(priceMutez) / 1e6} XTZ, NFT → alias ${alias}`,
];

console.log(`buyer ${from} (alias ${alias})`);
console.log(`pay ≤ ${fmtPay(swap.srcAmount)} · receive ≥ ${fmtXtz(fromEvmUnits(swap.dstAmountMin, XTZ.address))} · ask#${ASK_ID} = ${Number(priceMutez) / 1e6} XTZ · approval='${approval}'`);
console.log(`EVM batch — ${batch.length} tx, sent sequentially (a dApp sends them atomically in one wallet_sendCalls / EIP-5792):`);
steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
const hashes = await sendSequential(batch, EVM_EXPLORER);
console.log(`\n✅ done — ${hashes.length} tx confirmed, NFT bought onto alias ${alias}`);
