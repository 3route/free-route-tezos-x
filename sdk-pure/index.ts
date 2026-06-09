// index.ts — the L1 gist's `_index.ts`, rewritten 1:1 for Tezos X. Same flow: config -> getTokens ->
// availability check -> exact-out quote -> build [swap, fulfill] batch (+ in-batch approve) -> sign once.
//   KEPT 1:1 : the whole flow; objkt fulfill_ask via typed `objktContract.methodsObject.fulfill_ask(...)`;
//              batch().with([...]).send() + confirmation(1); parseUnits; the config object.
//   CHANGED  : 3route is EVM here -> the swap op is a `call_evm` to the router (not a Michelson contract call);
//              swap output goes to the EVM alias (auto-forwards to tz1) rather than directly to userAddress.
//   ADDED    : tz1->alias resolver; mutez(6)<->wei(18) split for XTZ; RpcForger + pinned fees (previewnet).
import { readFileSync } from 'node:fs';
import { InMemorySigner } from '@taquito/signer';
import { MichelsonMap, OpKind, RpcForger, TezosToolkit } from '@taquito/taquito';
import type { ParamsWithKind } from '@taquito/taquito';
import { parseUnits } from 'ethers';
import type { ObjktContract, ObjktContractFulfillAskParams } from './types.js';
import { NATIVE_XTZ, SWAP_SIG, ThreeRouteApi, buildCallEvm, tzToAlias, wrapOperationParamsWithEvmApprove } from './helpers.js';

const env = readEnvFile(new URL('../.env', import.meta.url));
const config = {
  rpcUrl: 'https://michelson.previewnet.tezosx.nomadic-labs.com',
  userSecret: env.TZ1_SK as string,
  gateway: 'KT18oDJJKXMKhfE1bSuAPGp92pYcwVDiqsPw', // Michelson->EVM gateway (replaces the gist's `freeRoute` Michelson contract)
  contracts: { objkt: (env.V4_MKT ?? 'KT1DzhZkEN8UZ6NkhGMDbgHh2W5zLqHDq4G7') as string },
  threeRouteApi: { baseUrl: process.env.RS_API ?? 'http://127.0.0.1:3000', chainId: 128064 },
};

// Example parameters (the gist bought USDT->XTZ; previewnet has USDC).
const inputTokenSymbol = process.env.PAY ?? 'USDC';
const outputTokenSymbol = 'XTZ';
const askId = process.env.ASK_ID as string;
const requiredAmount = Number(process.env.PRICE_XTZ ?? 0.004); // XTZ
const slippage = 0.02; // 2%

console.log(`Required output amount: ${requiredAmount} ${outputTokenSymbol}`);

// Set up Taquito and the 3route API
const tezosToolkit = new TezosToolkit(config.rpcUrl);
const signer = new InMemorySigner(config.userSecret);
tezosToolkit.setProvider({ signer });
tezosToolkit.setForgerProvider(tezosToolkit.getFactory(RpcForger)()); // ADDED: previewnet rejects local forging
const threeRouteApi = new ThreeRouteApi(config.threeRouteApi.baseUrl, config.threeRouteApi.chainId);
const userAddress = await signer.publicKeyHash();
const userAlias = tzToAlias(userAddress); // ADDED: EVM alias — the input ERC20 lives here, the swap runs as it
console.log('User address:', userAddress, '| EVM alias:', userAlias);

const tokens = await threeRouteApi.getTokens();
const tokensMap = new Map(tokens.map((t) => [t.symbol, t]));
const inputToken = tokensMap.get(inputTokenSymbol);
if (!inputToken) throw new Error(`Input token not found: ${inputTokenSymbol}`);
// (outputToken is native XTZ — addressed by the NATIVE_XTZ sentinel; no registry entry needed)

// Value conversion. XTZ is 6-dec mutez on Michelson but 18-dec wei on the EVM side.
const requiredAmountWithSlippage = requiredAmount * (1 + slippage);
const rawOutputMutez = parseUnits(requiredAmount.toString(), 6).toString(); // fulfill amount + ask price
const exactOutTargetWei = parseUnits(requiredAmountWithSlippage.toString(), 18).toString(); // exact-out target (EVM)

// Exact-out swap: inputToken -> native XTZ, output sent to the alias (which auto-forwards to tz1).
const [swap, objktContract] = await Promise.all([
  threeRouteApi.getSwap(inputToken.address, NATIVE_XTZ, exactOutTargetWei, userAlias, userAlias, slippage * 100),
  tezosToolkit.contract.at<ObjktContract>(config.contracts.objkt),
]);
const rawInputAmount = swap.srcAmount; // amountIn to pay/approve
console.log(`Pay ≤ ${rawInputAmount} ${inputToken.symbol} units · router ${swap.tx.to}`);

// 3route swap operation. Was `freeRouteContract.methodsObject.execute(...).toTransferParams()`; on Tezos X the
// router is EVM, so we wrap its server-built calldata in call_evm (sig + calldata-minus-selector).
const swapOperationParams = buildCallEvm(config.gateway, swap.tx.to, SWAP_SIG, swap.tx.data.slice(10));

// objkt operation — KEPT 1:1 with the gist (typed Michelson contract).
const objktFulfillAskParams: ObjktContractFulfillAskParams = {
  ask_id: askId,
  amount: '1',
  proxy_for: null,
  condition_extra: null,
  referrers: new MichelsonMap<string, string>(),
};
const objktFulfillAskOperationParams = objktContract.methodsObject
  .fulfill_ask(objktFulfillAskParams)
  .toTransferParams({ amount: Number(rawOutputMutez), mutez: true, gasLimit: 700_000, storageLimit: 2_000, fee: 150_000 });

// Batch [swap, fulfill] + prepend the in-batch approve — the gist's pattern (EVM approve instead of FA12/FA2).
let batchOperationParams: ParamsWithKind[] = [
  { kind: OpKind.TRANSACTION, ...swapOperationParams },
  { kind: OpKind.TRANSACTION, ...objktFulfillAskOperationParams },
];
batchOperationParams = wrapOperationParamsWithEvmApprove({
  operationParams: batchOperationParams,
  gateway: config.gateway,
  token: inputToken.address,
  spender: swap.tx.to,
  amount: rawInputAmount,
});

// Build a batch operation and send it
const batch = tezosToolkit.contract.batch().with(batchOperationParams);
console.log('Sending the operation...');
const batchOperation = await batch.send();
await batchOperation.confirmation(1);
console.log(`Operation sent: https://previewnet.tezosx.tzkt.io/${batchOperation.hash}`);

// ADDED (demo): confirm the NFT landed on the buyer tz1
const ownerKeys = (await fetch(`https://api.previewnet.tezosx.tzkt.io/v1/bigmaps/442/keys?key=${process.env.TOKEN ?? ''}`).then((r) => r.json()).catch(() => [])) as Array<{ value?: string }>;
if (process.env.TOKEN) console.log(`token ${process.env.TOKEN} owner: ${ownerKeys[0]?.value ?? '(none)'} ${ownerKeys[0]?.value === userAddress ? '✅ delivered to buyer' : ''}`);

function readEnvFile(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(url, 'utf8').split('\n')) {
    const e = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (e) out[e[1] as string] = e[2] as string;
  }
  return out;
}
