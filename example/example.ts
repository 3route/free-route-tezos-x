// Example: buy an objkt NFT paying any EVM ERC20, as ONE atomic Tezos op-group.
// Uses the SDK to build the universal swap+bridge ops, then APPENDS its own objkt `fulfill_ask` op and
// batches them. Quote flow mirrors the L1 gist: typed getTokens -> availability check -> exact-out /swap.
// Requires RS_API=http://host:port (live rust-3route). `SEND=1` runs it live. Reads ../.env (test wiring).
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { TezosToolkit, RpcForger } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import type { MichelsonV1Expression } from '@taquito/rpc';
import {
  PREVIEWNET,
  quoteExactOut,
  getTokens,
  tokenList,
  assertSupported,
  weiToMutez,
  buildSwapBridgeBatch,
  buildBatchTransaction,
} from '../sdk/index.js';
import type { NetworkConfig, Quote, ThreeRouteClient } from '../sdk/index.js';
import { buildFulfillAskOperation, buildIntent } from './objkt.js';

// --- env + config (consumer-side: RPCs, pay token, marketplace, FA2 — none of this is in the SDK) ---
const env = readEnvFile(new URL('../.env', import.meta.url));
const required = (key: string): string => {
  const value = env[key];
  if (!value) throw new Error(`missing ${key} in .env`);
  return value;
};
// SDK network config — only gateway / swapBridge / maxOpGas.
const NET: NetworkConfig = { ...PREVIEWNET, swapBridge: env.TD_SWAPBRIDGE2 ?? PREVIEWNET.swapBridge };
// Example-only addresses / endpoints.
const EVM_RPC = process.env.EVM_RPC ?? 'https://evm.previewnet.tezosx.nomadic-labs.com';
const TEZ_RPC = process.env.TEZ_RPC ?? 'https://michelson.previewnet.tezosx.nomadic-labs.com';
const USDC = '0x39fD36e60A839DE4cB5DaE0E1009c0aa612Bfba1';
const OBJKT_V4 = env.V4_MKT ?? 'KT1DzhZkEN8UZ6NkhGMDbgHh2W5zLqHDq4G7';
const FA2 = 'KT1Mv4XGEJCvaqY8YmkU4NgDzQme5zwzSbCi';
const PRICE_MUTEZ = Number(process.env.PRICE ?? 50_000); // mutez (default 0.05 XTZ)

// --- small utilities ---
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// Readable Micheline builders (test-only; the SDK never hand-builds the marketplace ask).
const m = {
  string: (s: string): MichelsonV1Expression => ({ string: s }),
  int: (n: number | string): MichelsonV1Expression => ({ int: String(n) }),
  pair: (...args: MichelsonV1Expression[]): MichelsonV1Expression => ({ prim: 'Pair', args }),
  right: (x: MichelsonV1Expression): MichelsonV1Expression => ({ prim: 'Right', args: [x] }),
  unit: { prim: 'Unit' } as MichelsonV1Expression,
  none: { prim: 'None' } as MichelsonV1Expression,
};

// --- init ---
const tezos = makeToolkit(required('TZ1_SK'));
const provider = new ethers.JsonRpcProvider(EVM_RPC, undefined, { batchMaxCount: 1 });
const buyerTz1 = await tezos.signer.publicKeyHash();

// --- get a swap quote (gist flow), then build the op-group and print it (no chain writes) ---
const { quote, pay } = await getQuote();
const sampleAskId = Number(env.TD_ASKID ?? 0);
const preview = await buildForAsk(sampleAskId, quote);

console.log('\n=== Intent (what the user reviews in the wallet) ===');
console.log(buildIntent({ nft: `marketplace ask#${sampleAskId}`, priceMutez: PRICE_MUTEZ, amountIn: quote.amountIn, payToken: pay, recipientTz1: buyerTz1 }));
console.log(`\nbuyer ${buyerTz1}\n alias ${preview.alias} | allowance->SwapBridge ${preview.allowance} | approve: ${preview.approvePrepended} | reset-first: ${preview.resetPrepended}`);
console.log(`\n=== batch -> ParamsWithKind[] (${preview.ops.length} ops: SDK swap+bridge + objkt fulfill) ===`);
console.dir(preview.ops, { depth: 6 });

// --- SEND=1: run it live (mint+list a fresh NFT from the funded test seller, then buy via the group) ---
if (process.env.SEND === '1') {
  const tokenId = Number(process.env.TOKEN ?? 62);
  const askId = await createTestListing(tokenId);
  await ensureAliasFunded(preview.alias, quote.tokenIn, quote.amountIn, pay.symbol);

  const buy = await buildForAsk(askId, quote);
  const ownerBefore = await ownerOf(tokenId);
  console.log(`\n>> SEND op-group (${buy.ops.length} ops, approve: ${buy.approvePrepended}, reset-first: ${buy.resetPrepended})`);
  const op = await tezos.contract.batch(buy.ops).send();
  console.log('  group:', op.hash, `https://previewnet.tezosx.tzkt.io/${op.hash}`);
  await op.confirmation();
  await delay(4_000);
  const ownerAfter = await ownerOf(tokenId);
  console.log(`\ntoken ${tokenId} owner: ${ownerBefore} -> ${ownerAfter}`);
  console.log(ownerAfter === buyerTz1 ? '✅ Bought + delivered the NFT to the buyer tz1 (SDK swap+bridge + objkt fulfill).' : '⚠️ unexpected owner — inspect.');
}

// ---------- helpers ----------
// Quote source: the gist flow against the live rust-3route server — typed getTokens -> availability check
// -> exact-out /swap -> parse into a Quote (real router calldata). PAY = symbol or address (default USDC).
async function getQuote(): Promise<{ quote: Quote; pay: { symbol: string; decimals: number } }> {
  const baseUrl = process.env.RS_API;
  if (!baseUrl) {
    throw new Error('set RS_API=http://host:port (optionally RS_CHAIN) — the SDK quotes against the live rust-3route server');
  }
  const client: ThreeRouteClient = { baseUrl, chainId: Number(process.env.RS_CHAIN ?? 128064) };

  const registry = await getTokens(client);
  const tokens = tokenList(registry);
  console.log(`[3route] ${client.baseUrl} chain ${client.chainId} — ${tokens.length} tokens: ${tokens.map((t) => t.symbol).join(', ')}`);

  const token = assertSupported(registry, process.env.PAY ?? USDC, process.env.PAY ?? 'USDC');
  console.log(`[3route] pay token ${token.symbol} (${token.decimals}dp) ${token.address} ✓ supported`);

  const result = await quoteExactOut({ cfg: NET, client, priceMutez: PRICE_MUTEZ, slippage: Number(process.env.SLIPPAGE ?? 1), tokenIn: token.address });
  console.log(`[3route] exact-out: ${weiToMutez(result.minXtzOut)} mutez XTZ <- ${result.amountIn} ${token.symbol} units · router ${result.router}`);
  return { quote: result, pay: { symbol: token.symbol, decimals: token.decimals } };
}

// SDK builds [reset?, approve?, swapAndBridgePull]; the example appends its objkt fulfill, then batches.
async function buildForAsk(askId: number, swapQuote: Quote) {
  const sb = await buildSwapBridgeBatch({ cfg: NET, provider, buyerTz1, quote: swapQuote });
  const fulfillOp = buildFulfillAskOperation({ objkt: OBJKT_V4, askId, priceMutez: PRICE_MUTEZ });
  const ops = buildBatchTransaction([...sb.ops, fulfillOp], { cfg: NET });
  return { ...sb, ops };
}

function makeToolkit(secretKey: string): TezosToolkit {
  const tk = new TezosToolkit(TEZ_RPC);
  tk.setProvider({ signer: new InMemorySigner(secretKey) });
  tk.setForgerProvider(tk.getFactory(RpcForger)()); // remote forge for proto 024
  return tk;
}

function readEnvFile(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(url, 'utf8').split('\n')) {
    const entry = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (entry) out[entry[1] as string] = entry[2] as string;
  }
  return out;
}

async function ownerOf(tokenId: number): Promise<string> {
  const keys = (await fetch(`https://api.previewnet.tezosx.tzkt.io/v1/bigmaps/442/keys?key=${tokenId}`)
    .then((r) => r.json())
    .catch(() => [])) as Array<{ value?: string }>;
  return keys[0]?.value ?? '(none)';
}

// Make sure the buyer alias holds >= amountIn of the pay token. If short, top up the shortfall from the funded
// EOA (any ERC20). If the EOA can't cover it either, print exactly what to send where and abort, then re-run.
async function ensureAliasFunded(alias: string, token: string, amountIn: bigint, label: string): Promise<void> {
  const erc20 = new ethers.Contract(
    token,
    ['function transfer(address,uint256) returns(bool)', 'function balanceOf(address) view returns(uint256)'],
    new ethers.Wallet(required('EVM_PK'), provider),
  ) as unknown as { transfer(to: string, v: bigint): Promise<ethers.TransactionResponse>; balanceOf(a: string): Promise<bigint> };
  const have = await erc20.balanceOf(alias);
  if (have >= amountIn) {
    console.log(`alias already holds ${have} ${label} units (need ${amountIn}) — no top-up`);
    return;
  }
  const need = amountIn - have;
  const eoa = await new ethers.Wallet(required('EVM_PK')).getAddress();
  const eoaBal = await erc20.balanceOf(eoa);
  if (eoaBal < need) {
    throw new Error(`fund the buyer alias ${alias} with >= ${need} more ${label} units (token ${token}); EOA ${eoa} holds only ${eoaBal}`);
  }
  console.log(`top up alias with ${need} ${label} units from EOA ${eoa}`);
  await (await erc20.transfer(alias, need)).wait();
}

// Mint a fresh NFT to the funded test seller and list it (creator must differ from the buyer). Returns the ask id.
async function createTestListing(tokenId: number): Promise<number> {
  const seller = required('TD_SELLER');
  const sellerTezos = makeToolkit(required('TD_SELLER_SK'));
  if ((await ownerOf(tokenId)) === '(none)') {
    console.log(`\nmint token ${tokenId} -> seller`);
    await (await tezos.contract.transfer({ to: FA2, amount: 0, parameter: { entrypoint: 'mint', value: m.pair(m.string(seller), m.int(tokenId)) }, gasLimit: 200_000, storageLimit: 350, fee: 50_000 })).confirmation();
  }
  const marketplace = await sellerTezos.contract.at(OBJKT_V4);
  const askId = ((await marketplace.storage()) as { next_ask_id: { toNumber(): number } }).next_ask_id.toNumber();
  console.log(`seller creates ask#${askId} (token ${tokenId})`);
  await (await sellerTezos.contract.transfer({ to: OBJKT_V4, amount: 0, parameter: { entrypoint: 'ask', value: askValue(seller, tokenId) }, gasLimit: 1_500_000, storageLimit: 3_000, fee: 200_000 })).confirmation();
  return askId;
}

// objkt v4 %ask value for a fixed-price (currency = tez) single-edition listing.
function askValue(seller: string, tokenId: number): MichelsonV1Expression {
  const token = m.pair(m.string(FA2), m.int(tokenId));
  const currencyTez = m.right(m.right(m.unit)); // or(fa12 | or(fa2 | tez)) -> tez
  const shares = [{ prim: 'Elt', args: [m.string(seller), m.int(1000)] }] as unknown as MichelsonV1Expression;
  return m.pair(token, currencyTez, m.int(PRICE_MUTEZ), m.int(1), shares, m.none, m.none, m.int(0), m.none);
}
