// scripts/michelson/bridge.ts — Michelson-native swap signed by BUYER_MICHELSON_SK (InMemorySigner, no
// Temple). Swaps SRC_SYMBOL -> DST_SYMBOL on the buyer's alias; RECEIVER (optional) redirects the output to a
// DIFFERENT EVM address via getSwap `receiver` (works for any input; a native-XTZ output auto-forwards from
// an alias receiver to its Michelson account, but stays on a plain EOA).
// Run:  [SRC_SYMBOL=USDC DST_SYMBOL=XTZ IN_AMOUNT=0.05 RECEIVER=0x..] npm run bridge:michelson
import { InMemorySigner } from '@taquito/signer';
import { RpcForger, TezosToolkit } from '@taquito/taquito';
import { XTZ, FreeRouteTezosX, michelsonToEvmAlias, toEvmUnits, tezosXPreviewnet } from '../../src/index.js';
import type { EvmAddress } from '../../src/index.js';
import { findToken } from '../shared/client.js';
import { env, need } from '../shared/env.js';
import { sendGroup } from './send.js';

const MICHELSON_RPC = need('MICHELSON_RPC');
const SRC_SYMBOL = env.SRC_SYMBOL ?? 'USDC'; // input token (default: the USDC the buyer's alias holds)
const DST_SYMBOL = env.DST_SYMBOL ?? 'XTZ'; // output token
const IN_AMOUNT = Number(env.IN_AMOUNT ?? 0.05); // input, in SRC consumer units

const tezos = new TezosToolkit(MICHELSON_RPC);
tezos.setProvider({ signer: new InMemorySigner(need('BUYER_MICHELSON_SK')) });
tezos.setForgerProvider(tezos.getFactory(RpcForger)()); // previewnet rejects local forging
const fr = new FreeRouteTezosX({ network: tezosXPreviewnet, baseUrl: need('FREE_ROUTE_API'), apiKey: need('FREE_ROUTE_API_KEY') });

const signer = await tezos.signer.publicKeyHash();
const swapperAlias = michelsonToEvmAlias(signer); // the EVM identity that runs the swap (holds the ERC20)
const receiver = (env.RECEIVER as EvmAddress | undefined) ?? swapperAlias; // optional: send the output elsewhere

const xtz = { address: XTZ.address, decimals: 6, symbol: 'XTZ' };
const src = SRC_SYMBOL === 'XTZ' ? xtz : await findToken(fr, SRC_SYMBOL);
const dst = DST_SYMBOL === 'XTZ' ? xtz : await findToken(fr, DST_SYMBOL);

const swap = await fr.getSwap({
  src: src.address,
  dst: dst.address,
  amount: toEvmUnits(BigInt(Math.round(IN_AMOUNT * 10 ** src.decimals)), src.address),
  isExactOut: false,
  from: swapperAlias,
  receiver,
});
// ERC20 input -> approve(s) via call_evm (default resetThenApprove); native XTZ input carries msg.value, no approve.
const ops = fr.michelson.buildSwapOperation({ swap, srcAddress: src.address, approval: src.address === XTZ.address ? 'none' : 'resetThenApprove' });
console.log(`swapper ${signer} (alias ${swapperAlias}) · ${IN_AMOUNT} ${SRC_SYMBOL} -> ${DST_SYMBOL} · receiver ${receiver} · ${ops.length} op(s), one signature...`);
const hash = await sendGroup(tezos, ops);
console.log(`Done: ${need('TZKT_EXPLORER')}/${hash}`);
