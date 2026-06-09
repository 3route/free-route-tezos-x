// Clean atomicity test for the contract-less path: fund the alias, then run a group whose SWAP is valid but
// whose fulfill is DOOMED (nonexistent ask) -> the whole op-group must revert and the pulled USDC is restored.
// This proves "swap succeeds but fulfill fails -> swap rolls back" (the case the e2e's (C) couldn't isolate).
// Funding stays on the alias (group reverts), so it costs only fees. Run: RS_API=... PRICE=4000 npx tsx pure-sdk-spike/atomicity.ts
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { TezosToolkit, RpcForger } from '@taquito/taquito';
import type { TransferParams } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import type { MichelsonV1Expression } from '@taquito/rpc';
import { PREVIEWNET, tzToAlias, mutezToWei, encodeApproveArgs, getSwap, NATIVE_XTZ, buildBatchTransaction } from '../sdk/index.js';
import type { ThreeRouteClient } from '../sdk/index.js';
import { buildFulfillAskOperation } from '../example/objkt.js';

const SWAP_SIG = 'swap(uint256,uint256,address,uint256,uint256,(address[],uint256),(address,uint256)[],(address,uint256,uint256))';
const env: Record<string, string> = {};
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) { const e = line.match(/^([A-Z0-9_]+)=(.*)$/); if (e) env[e[1] as string] = e[2] as string; }
const need = (k: string): string => { const v = env[k]; if (!v) throw new Error(`missing ${k}`); return v; };
const EVM_RPC = 'https://evm.previewnet.tezosx.nomadic-labs.com';
const USDC = '0x39fD36e60A839DE4cB5DaE0E1009c0aa612Bfba1';
const OBJKT_V4 = env.V4_MKT ?? 'KT1DzhZkEN8UZ6NkhGMDbgHh2W5zLqHDq4G7';
const PRICE = Number(process.env.PRICE ?? 4000);
const BOGUS_ASK = 999_999_999; // does not exist -> fulfill_ask reverts
const client: ThreeRouteClient = { baseUrl: process.env.RS_API ?? 'http://127.0.0.1:3000', chainId: 128064 };

const tezos = new TezosToolkit(EVM_RPC.replace('evm', 'michelson'));
tezos.setProvider({ signer: new InMemorySigner(need('TZ1_SK')) });
tezos.setForgerProvider(tezos.getFactory(RpcForger)());
const buyerTz1 = await tezos.signer.publicKeyHash();
const alias = tzToAlias(buyerTz1);
const provider = new ethers.JsonRpcProvider(EVM_RPC, undefined, { batchMaxCount: 1 });
const usdc = new ethers.Contract(USDC, ['function transfer(address,uint256) returns(bool)', 'function balanceOf(address) view returns(uint256)'], new ethers.Wallet(need('EVM_PK'), provider)) as unknown as { transfer(t: string, v: bigint): Promise<ethers.TransactionResponse>; balanceOf(a: string): Promise<bigint> };

const callEvm = (dest: string, sig: string, abiargsNo0x: string): TransferParams => ({
  to: PREVIEWNET.gatewayTez, amount: 0,
  parameter: { entrypoint: 'call_evm', value: { prim: 'Pair', args: [{ string: dest }, { string: sig }, { bytes: abiargsNo0x }, { prim: 'None' }] } },
  gasLimit: 500_000, storageLimit: 2_000, fee: 150_000,
});

const resp = await getSwap(client, { src: USDC, dst: NATIVE_XTZ, amount: mutezToWei(PRICE), from: alias, receiver: alias, slippage: 2, isExactOutput: true });
const amountIn = BigInt(resp.srcAmount);
console.log(`exact-out ${PRICE} mutez <- ${amountIn} USDC · router ${resp.tx.to}`);

// fund alias so the SWAP would succeed (the point: prove it still rolls back when fulfill fails)
const have = await usdc.balanceOf(alias);
if (have < amountIn) {
  const eoa = await new ethers.Wallet(need('EVM_PK')).getAddress();
  const eb = await usdc.balanceOf(eoa);
  if (eb < amountIn - have) throw new Error(`EOA short on USDC: has ${eb}, need ${amountIn - have}`);
  console.log(`fund alias with ${amountIn - have} USDC`);
  await (await usdc.transfer(alias, amountIn - have)).wait();
}

const ops = buildBatchTransaction([
  callEvm(USDC, 'approve(address,uint256)', encodeApproveArgs(resp.tx.to, amountIn).slice(2)),
  callEvm(resp.tx.to, SWAP_SIG, resp.tx.data.slice(10)),
  buildFulfillAskOperation({ objkt: OBJKT_V4, askId: BOGUS_ASK, priceMutez: PRICE }), // DOOMED
], { cfg: PREVIEWNET });

const before = await usdc.balanceOf(alias);
console.log(`\nalias USDC before: ${before}  (swap is valid; fulfill targets nonexistent ask#${BOGUS_ASK})`);
try {
  const op = await tezos.contract.batch(ops).send();
  await op.confirmation();
  console.log('⚠️ group unexpectedly applied —', op.hash);
} catch (e) {
  console.log('group rejected (expected):', String((e as Error).message).split('\n')[0].slice(0, 110));
}
await new Promise((r) => setTimeout(r, 4000));
const after = await usdc.balanceOf(alias);
console.log(`alias USDC after:  ${after}`);
console.log(after === before ? '\n✅ ATOMIC: swap was valid yet the failed fulfill rolled back the whole group — USDC restored.' : '\n⚠️ USDC changed — NOT atomic, inspect.');
