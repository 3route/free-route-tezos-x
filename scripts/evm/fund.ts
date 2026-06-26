// scripts/evm/fund.ts — top up the EVM account's pay-token via an EVM-signed XTZ -> token swap (the account
// pays its own XTZ). Used by setup so `example-buy:evm` is ready without a manual `bridge:evm`. Needs EVM_SK.
import { XTZ, readErc20Balance } from '../../src/index.js';
import type { FreeRouteTezosX, FreeRouteToken } from '../../src/index.js';
import { evmAccount, sendSequential } from './send.js';
import { need } from '../shared/env.js';

const EVM_RPC = need('EVM_RPC');
const EVM_EXPLORER = need('EVM_EXPLORER');

/** Ensure the EVM account holds ≥ `needed` of `token`; if short, swap XTZ → token (EVM-signed) up to 2×. */
export async function ensureEvmToken(fr: FreeRouteTezosX, token: FreeRouteToken, needed: bigint): Promise<void> {
  const from = evmAccount().address;
  const fmt = (x: bigint) => `${Number(x) / 10 ** token.decimals} ${token.symbol}`;
  const have = await readErc20Balance({ evmRpc: EVM_RPC, token: token.address, owner: from });
  console.log(`EVM account ${from}: have ${fmt(have)} · need ${fmt(needed)}`);
  if (have >= needed) {
    console.log(`  already funded — skip`);
    return;
  }
  // exact-out: get (2×needed − have) token, native XTZ in (carries msg.value, no approve). The EVM account pays.
  const swap = await fr.getSwap({ src: XTZ.address, dst: token.address, amount: needed * 2n - have, isExactOut: true, from, receiver: from, slippageBps: 300 });
  console.log(`  fund ${fmt(needed * 2n - have)} via XTZ swap (router ${swap.tx.to}), EVM-signed:`);
  await sendSequential(fr.evm.buildSwapTransaction({ swap, srcAddress: XTZ.address }), EVM_EXPLORER);
}
