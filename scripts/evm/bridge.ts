// scripts/evm/bridge.ts — EVM-native Bridge (MetaMask-style, no Temple): the free-route /swap response's
// `tx` IS a raw EVM transaction, so a native EVM account just sends it. Here: swap a little native XTZ ->
// PAY_SYMBOL token on the EVM account itself (also a handy way to fund it for `example-buy:evm`).
// Run:  [PAY_SYMBOL=USDC IN_XTZ=0.05] npm run bridge:evm
import { XTZ, readErc20Balance, toEvmUnits } from '../../src/index.js';
import { findToken, newFreeRoute } from '../shared/client.js';
import { evmAccount, sendSequential } from './send.js';
import { env, need } from '../shared/env.js';

const EVM_RPC = need('EVM_RPC');
const EVM_EXPLORER = need('EVM_EXPLORER');
const PAY_SYMBOL = env.PAY_SYMBOL ?? 'USDC';
const IN_XTZ = Number(env.IN_XTZ ?? 0.05);

const fr = newFreeRoute();
const from = evmAccount().address;
const token = await findToken(fr, PAY_SYMBOL);
const fmt = (x: bigint) => `${Number(x) / 10 ** token.decimals} ${PAY_SYMBOL}`;

const before = await readErc20Balance({ evmRpc: EVM_RPC, token: token.address, owner: from });
console.log(`from ${from} · ${fmt(before)} before`);

// exact-in: native XTZ -> PAY_SYMBOL. Native input carries the XTZ as msg.value, so no approve.
const swap = await fr.getSwap({ src: XTZ.address, dst: token.address, amount: toEvmUnits(BigInt(Math.round(IN_XTZ * 1e6)), XTZ.address), isExactOut: false, from });
const txs = fr.evm.buildSwap({ swap, srcAddress: XTZ.address });
console.log(`swap ${IN_XTZ} XTZ -> ${PAY_SYMBOL} via router ${swap.tx.to} · sending ${txs.length} tx(s)...`);
await sendSequential(txs, EVM_EXPLORER);

const after = await readErc20Balance({ evmRpc: EVM_RPC, token: token.address, owner: from });
console.log(`\n✅ ${fmt(after)} after (Δ ${fmt(after - before)})`);
