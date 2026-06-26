// scripts/evm/bridge.ts — EVM-native Bridge (MetaMask-style, no Temple): the free-route /swap response's
// `tx` IS a raw EVM transaction, so a native EVM account just sends it. Swaps SRC_SYMBOL -> DST_SYMBOL on the
// EVM account; RECEIVER (optional) redirects the output to a DIFFERENT EVM address via getSwap `receiver`
// (works for any input — native XTZ or ERC20; verified on-chain). Defaults swap native XTZ -> PAY_SYMBOL onto
// the account (also funds it for example-buy:evm).
// Run:  [SRC_SYMBOL=XTZ DST_SYMBOL=USDC IN_AMOUNT=0.05 RECEIVER=0x..] npm run bridge:evm
import { XTZ, readErc20Balance, toEvmUnits } from '../../src/index.js';
import type { EvmAddress } from '../../src/index.js';
import { findToken, newFreeRoute } from '../shared/client.js';
import { evmAccount, publicClient, sendSequential } from './send.js';
import { env, need } from '../shared/env.js';

const EVM_RPC = need('EVM_RPC');
const EVM_EXPLORER = need('EVM_EXPLORER');
const SRC_SYMBOL = env.SRC_SYMBOL ?? 'XTZ'; // input token (default native XTZ)
const DST_SYMBOL = env.DST_SYMBOL ?? env.PAY_SYMBOL ?? 'USDC'; // output token
const IN_AMOUNT = Number(env.IN_AMOUNT ?? env.IN_XTZ ?? 0.05); // input, in SRC consumer units

const fr = newFreeRoute();
const from = evmAccount().address;
const receiver = (env.RECEIVER as EvmAddress | undefined) ?? from; // optional: send the output elsewhere

const xtz = { address: XTZ.address, decimals: 6, symbol: 'XTZ' };
const src = SRC_SYMBOL === 'XTZ' ? xtz : await findToken(fr, SRC_SYMBOL);
const dst = DST_SYMBOL === 'XTZ' ? xtz : await findToken(fr, DST_SYMBOL);
const fmt = (x: bigint) => `${Number(x) / 10 ** dst.decimals} ${dst.symbol}`;
// balance of the OUTPUT token on the receiver — native XTZ on the EVM side is read as the 18-dec gas balance.
// CAVEAT: if the receiver is the alias of a tz1, native XTZ auto-forwards to that tz1, so its EVM-side balance
// won't move (check the tz1 on the Michelson side instead). Accurate for self/EOA receivers and for ERC20 output.
const dstBalance = async (): Promise<bigint> =>
  dst.address === XTZ.address
    ? (await publicClient.getBalance({ address: receiver as `0x${string}` })) / 1_000_000_000_000n // wei(18) -> mutez(6)
    : readErc20Balance({ evmRpc: EVM_RPC, token: dst.address, owner: receiver });

const before = await dstBalance();
console.log(`from ${from} · receiver ${receiver} · ${fmt(before)} before`);

const swap = await fr.getSwap({
  src: src.address,
  dst: dst.address,
  amount: toEvmUnits(BigInt(Math.round(IN_AMOUNT * 10 ** src.decimals)), src.address),
  isExactOut: false,
  from,
  receiver,
});
const txs = fr.evm.buildSwapTransaction({ swap, srcAddress: src.address });
console.log(`swap ${IN_AMOUNT} ${src.symbol} -> ${dst.symbol} via router ${swap.tx.to}, receiver ${receiver} · sending ${txs.length} tx(s)...`);
await sendSequential(txs, EVM_EXPLORER);

const after = await dstBalance();
console.log(`\n✅ ${fmt(after)} ${dst.symbol} after on ${receiver} (Δ ${fmt(after - before)})`);
