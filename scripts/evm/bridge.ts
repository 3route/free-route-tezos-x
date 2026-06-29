// scripts/evm/bridge.ts — EVM-native Bridge (MetaMask-style, no Temple): the free-route /swap response's `tx`
// IS a raw EVM transaction, so a native EVM account just sends it. Swaps SRC_SYMBOL -> DST_SYMBOL on the EVM
// account; `receiver` (optional) redirects the output to a DIFFERENT EVM address via getSwap `receiver` (works
// for any input — native XTZ or ERC20). Defaults swap native XTZ -> PAY_SYMBOL onto the account.
//
// `bridgeEvm(...)` is the reusable flow (shared with the e2e suite); the bottom is the CLI wrapper.
// Run:  [SRC_SYMBOL=XTZ DST_SYMBOL=USDC IN_AMOUNT=0.05 RECEIVER=0x..] npm run bridge:evm
import { fromEvmUnits, toEvmUnits } from '../../src/index.js';
import type { EvmAddress, FreeRouteToken, FreeRouteTezosX } from '../../src/index.js';
import { newFreeRoute, resolveToken } from '../shared/client.js';
import { isMain, noop, type Log } from '../shared/ctx.js';
import { env, need } from '../shared/env.js';
import { evmAccount, sendSequential } from './send.js';

export interface EvmSwapResult {
  hashes: string[];
  src: FreeRouteToken;
  dst: FreeRouteToken;
  receiver: EvmAddress;
  minOut: bigint; // guaranteed dst output (consumer base units)
}

/** Swap `srcSymbol` -> `dstSymbol` from a native EVM account (the raw /swap tx, sent directly). */
export async function bridgeEvm(args: {
  freeRoute: FreeRouteTezosX;
  evmAccount: EvmAddress; // the native 0x that signs + pays
  srcSymbol: string;
  dstSymbol: string;
  inAmount: number; // in SRC consumer units
  receiver?: EvmAddress | null; // default: the EVM account itself
  evmExplorer?: string;
  log?: Log;
}): Promise<EvmSwapResult> {
  const { freeRoute, evmAccount: from, srcSymbol, dstSymbol, inAmount } = args;
  const receiver = args.receiver ?? from;
  const log = args.log ?? noop;

  const src = await resolveToken(freeRoute, srcSymbol);
  const dst = await resolveToken(freeRoute, dstSymbol);
  const swap = await freeRoute.getSwap({
    src: src.address,
    dst: dst.address,
    amount: toEvmUnits(BigInt(Math.round(inAmount * 10 ** src.decimals)), src.address),
    isExactOut: false,
    from,
    receiver,
  });
  const txs = freeRoute.evm.buildSwapTransaction({ swap, srcAddress: src.address });
  log(`from ${from} · ${inAmount} ${srcSymbol} -> ${dstSymbol} via router ${swap.tx.to} · receiver ${receiver} · sending ${txs.length} tx(s)...`);
  const hashes = await sendSequential(txs, args.evmExplorer);
  return { hashes, src, dst, receiver, minOut: fromEvmUnits(swap.dstAmountMin, dst.address) };
}

// ── CLI ──
if (isMain(import.meta.url)) {
  const r = await bridgeEvm({
    freeRoute: newFreeRoute(),
    evmAccount: evmAccount().address,
    srcSymbol: env.SRC_SYMBOL ?? 'XTZ',
    dstSymbol: env.DST_SYMBOL ?? env.PAY_SYMBOL ?? 'USDC',
    inAmount: Number(env.IN_AMOUNT ?? env.IN_XTZ ?? 0.05),
    receiver: env.RECEIVER as EvmAddress | undefined,
    evmExplorer: need('EVM_EXPLORER'),
    log: console.log,
  });
  console.log(`\n✅ ${r.hashes.length} tx confirmed · ${r.dst.symbol} → ${r.receiver} (min ${Number(r.minOut) / 10 ** r.dst.decimals} ${r.dst.symbol})`);
}
