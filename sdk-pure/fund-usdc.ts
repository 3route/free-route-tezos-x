// One-off: top up the buyer alias with USDC by swapping a little of the tz1's XTZ -> USDC via the router
// (call_evm from tz1, exact-in). Lets the narrated buy run when the EOA is out of USDC.
// Run: RS_API=http://127.0.0.1:3000 XTZ_IN=0.5 npx tsx sdk-pure/fund-usdc.ts
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { TezosToolkit, RpcForger } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import { NATIVE_XTZ, SWAP_SIG, buildCallEvm, tzToAlias } from './helpers.js';

const env: Record<string, string> = {};
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) { const e = line.match(/^([A-Z0-9_]+)=(.*)$/); if (e) env[e[1] as string] = e[2] as string; }
const TEZ_RPC = 'https://michelson.previewnet.tezosx.nomadic-labs.com';
const EVM_RPC = 'https://evm.previewnet.tezosx.nomadic-labs.com';
const GATEWAY = 'KT18oDJJKXMKhfE1bSuAPGp92pYcwVDiqsPw';
const USDC = '0x39fD36e60A839DE4cB5DaE0E1009c0aa612Bfba1';
const RS = process.env.RS_API ?? 'http://127.0.0.1:3000';
const XTZ_IN = Number(process.env.XTZ_IN ?? 0.5);
const mutez = Math.round(XTZ_IN * 1e6);
const wei = (BigInt(mutez) * 10n ** 12n).toString();

const tezos = new TezosToolkit(TEZ_RPC);
tezos.setProvider({ signer: new InMemorySigner(env.TZ1_SK as string) });
tezos.setForgerProvider(tezos.getFactory(RpcForger)());
const alias = tzToAlias(await tezos.signer.publicKeyHash());
const provider = new ethers.JsonRpcProvider(EVM_RPC, undefined, { batchMaxCount: 1 });
const usdc = new ethers.Contract(USDC, ['function balanceOf(address) view returns(uint256)'], provider) as unknown as { balanceOf(a: string): Promise<bigint> };

// exact-IN swap: spend `wei` native XTZ -> USDC, output to the alias
const q = new URLSearchParams({ src: NATIVE_XTZ, dst: USDC, amount: wei, from: alias, receiver: alias, slippage: '3' });
const swap = (await fetch(`${RS}/api/v6.1/128064/swap?${q}`).then((r) => r.json())) as { srcAmount: string; dstAmount: string; tx: { to: string; data: string; value: string } };
console.log(`spend ${XTZ_IN} XTZ -> ~${swap.dstAmount} USDC units · router ${swap.tx.to}`);

const before = await usdc.balanceOf(alias);
const op = await tezos.contract.transfer({ to: GATEWAY, amount: mutez, mutez: true, parameter: { entrypoint: 'call_evm', value: { prim: 'Pair', args: [{ string: swap.tx.to }, { string: SWAP_SIG }, { bytes: swap.tx.data.slice(10) }, { prim: 'None' }] } }, gasLimit: 500_000, storageLimit: 2_000, fee: 150_000 });
console.log('op:', op.hash);
await op.confirmation();
await new Promise((r) => setTimeout(r, 4000));
const after = await usdc.balanceOf(alias);
console.log(`alias USDC: ${before} -> ${after}  (+${after - before})`);
