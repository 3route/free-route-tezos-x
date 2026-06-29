// scripts/michelson/bridge.ts — Michelson-native swap signed by an InMemorySigner (no Temple). Swaps
// SRC_SYMBOL -> DST_SYMBOL on the buyer's alias; `receiver` (optional) redirects the output to a DIFFERENT EVM
// address via getSwap `receiver` (works for any input; a native-XTZ output auto-forwards from an alias receiver
// to its Michelson account, but stays on a plain EOA).
//
// `bridgeMichelson(...)` is the reusable flow (shared with the e2e suite); the bottom is the CLI wrapper.
// Run:  [SRC_SYMBOL=USDC DST_SYMBOL=XTZ IN_AMOUNT=0.05 RECEIVER=0x..] npm run bridge:michelson
import type { TezosToolkit } from '@taquito/taquito';
import { XTZ, fromEvmUnits, michelsonToEvmAlias, toEvmUnits } from '../../src/index.js';
import type { EvmAddress, FreeRouteToken, FreeRouteTezosX } from '../../src/index.js';
import { newFreeRoute, resolveToken } from '../shared/client.js';
import { isMain, makeToolkit, noop, type Log } from '../shared/ctx.js';
import { env, need } from '../shared/env.js';
import { sendGroup } from './send.js';

export interface SwapResult {
  hash: string;
  src: FreeRouteToken;
  dst: FreeRouteToken;
  receiver: EvmAddress;
  minOut: bigint; // guaranteed dst output (consumer base units)
}

/** Swap `srcSymbol` -> `dstSymbol` on the buyer's alias, signed once (one Michelson op-group). */
export async function bridgeMichelson(args: {
  freeRoute: FreeRouteTezosX;
  buyer: TezosToolkit;
  buyerAddress: string;
  buyerAlias: EvmAddress;
  srcSymbol: string;
  dstSymbol: string;
  inAmount: number; // in SRC consumer units
  receiver?: EvmAddress | null; // default: the buyer's alias
  tzktExplorer?: string;
  log?: Log;
}): Promise<SwapResult> {
  const { freeRoute, buyer, buyerAddress, buyerAlias, srcSymbol, dstSymbol, inAmount } = args;
  const receiver = args.receiver ?? buyerAlias;
  const log = args.log ?? noop;

  const src = await resolveToken(freeRoute, srcSymbol);
  const dst = await resolveToken(freeRoute, dstSymbol);
  const swap = await freeRoute.getSwap({
    src: src.address,
    dst: dst.address,
    amount: toEvmUnits(BigInt(Math.round(inAmount * 10 ** src.decimals)), src.address),
    isExactOut: false,
    from: buyerAlias,
    receiver,
  });
  // ERC20 input -> approve(s) via call_evm (default resetThenApprove); native XTZ input carries msg.value, no approve.
  const ops = freeRoute.michelson.buildSwapOperation({ swap, srcAddress: src.address, approval: src.address === XTZ.address ? 'none' : 'resetThenApprove' });
  log(`swapper ${buyerAddress} (alias ${buyerAlias}) · ${inAmount} ${srcSymbol} -> ${dstSymbol} · receiver ${receiver} · ${ops.length} op(s), one signature...`);
  const hash = await sendGroup(buyer, ops);
  return { hash, src, dst, receiver, minOut: fromEvmUnits(swap.dstAmountMin, dst.address) };
}

// ── CLI ──
if (isMain(import.meta.url)) {
  const michelsonRpc = need('MICHELSON_RPC');
  const buyer = makeToolkit(michelsonRpc, need('BUYER_MICHELSON_SK'));
  const buyerAddress = await buyer.signer.publicKeyHash();
  const r = await bridgeMichelson({
    freeRoute: newFreeRoute(),
    buyer,
    buyerAddress,
    buyerAlias: michelsonToEvmAlias(buyerAddress),
    srcSymbol: env.SRC_SYMBOL ?? 'USDC',
    dstSymbol: env.DST_SYMBOL ?? 'XTZ',
    inAmount: Number(env.IN_AMOUNT ?? 0.05),
    receiver: env.RECEIVER as EvmAddress | undefined,
    log: console.log,
  });
  console.log(`Done: ${need('TZKT_EXPLORER')}/${r.hash}`);
}
