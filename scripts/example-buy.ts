// scripts/example-buy.ts — minimal headless buy: pay an EVM ERC20 for an XTZ-priced objkt NFT, signed by a
// secret key (InMemorySigner — no Beacon/Temple wallet). Everything is hardcoded except the secret key, which
// comes from the SECRET_KEY env var. One atomic op-group: [approve, swap(call_evm), fulfill_ask].
//   Run:  SECRET_KEY=edsk... npx tsx scripts/example-buy.ts
import { InMemorySigner } from '@taquito/signer';
import { RpcForger, TezosToolkit } from '@taquito/taquito';
import { ThreeRouteTezosX, XTZ, buildBatchTransaction, objkt, sendGroup, targetForMinOut, tezosXPreviewnet } from '../sdk/index.js';

// ── hardcoded config (edit ASK_ID / PRICE_MUTEZ to a live ask) ───────────────────────────────
const SECRET_KEY = process.env.SECRET_KEY; // the ONLY input — buyer's Michelson secret key
const MICHELSON_RPC = 'https://michelson.previewnet.tezosx.nomadic-labs.com';
const NETWORK = tezosXPreviewnet; // chainId + gateway + default 3route apiBaseUrl (localhost)

const MARKETPLACE = objkt.previewnet.marketplace; // objkt v4 for this network
const ASK_ID = '45';
const PRICE_MUTEZ = 1_000n; // 0.001 XTZ — must match the ask price
const PAY_SYMBOL = 'USDC'; // ERC20 to pay with (held on the buyer's alias)
const SLIPPAGE_BPS = 200; // 2%
// ─────────────────────────────────────────────────────────────────────────────────────────────

if (!SECRET_KEY) throw new Error('set SECRET_KEY (the buyer Michelson secret key) in the env');

const tezos = new TezosToolkit(MICHELSON_RPC);
tezos.setProvider({ signer: new InMemorySigner(SECRET_KEY) });
tezos.setForgerProvider(tezos.getFactory(RpcForger)()); // previewnet rejects local forging
const swapper = new ThreeRouteTezosX({ network: NETWORK }); // baseUrl defaults to NETWORK.apiBaseUrl

const account = await tezos.signer.publicKeyHash();
const payToken = (await swapper.getTokens()).find((t) => t.symbol === PAY_SYMBOL);
if (!payToken) throw new Error(`pay token ${PAY_SYMBOL} not in the 3route registry`);

// exact-out payToken -> XTZ: size the target so the on-chain floor covers the ask price.
const target = targetForMinOut(PRICE_MUTEZ, SLIPPAGE_BPS);
const { ops, details } = await swapper.prepareSwap({ account, src: payToken, dst: XTZ, amount: target, exactOut: true, slippageBps: SLIPPAGE_BPS });
console.log(`buyer ${account} · pay ≤ ${details.src.amount} ${PAY_SYMBOL} · receive ≥ ${details.dst.min} mutez (price ${PRICE_MUTEZ}) · router ${details.router}`);

// compose the atomic group: swap leg + marketplace fulfill (paid by the bridged XTZ), one signature.
const fulfill = objkt.buildFulfillAsk({ marketplace: MARKETPLACE, askId: ASK_ID, amountMutez: PRICE_MUTEZ });
const group = buildBatchTransaction(ops, fulfill);
console.log(`Sending ${group.length}-op atomic group…`);
const hash = await sendGroup(tezos, group);
console.log(`Done: https://previewnet.tezosx.tzkt.io/${hash}`);
