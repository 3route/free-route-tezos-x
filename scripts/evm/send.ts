// scripts/evm/send.ts — EVM signer/sender for the demo (viem + a private key from .env). The SDK's evm
// builders return EvmTxRequest[]; here we send them. In a dApp these go atomically in ONE wallet_sendCalls
// (EIP-5792); headless (no wallet) we send them sequentially as an on-chain functional check.
import { createPublicClient, createWalletClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { EvmTxRequest } from '../../src/index.js';
import { need } from '../shared/env.js';

const EVM_RPC = need('EVM_RPC');
export const CHAIN_ID = 128064; // Tezos X previewnet

export const tezosXEvm = defineChain({
  id: CHAIN_ID,
  name: 'Tezos X Previewnet (EVM)',
  nativeCurrency: { name: 'Tez', symbol: 'XTZ', decimals: 18 },
  rpcUrls: { default: { http: [EVM_RPC] } },
});

export const publicClient = createPublicClient({ chain: tezosXEvm, transport: http(EVM_RPC) });

/** The EVM signer (EVM_SK). Its address is the native account; its Michelson alias is where NFTs land. */
export const evmAccount = () => privateKeyToAccount(need('EVM_SK') as `0x${string}`);

const wallet = () => createWalletClient({ account: evmAccount(), chain: tezosXEvm, transport: http(EVM_RPC) });

/**
 * Send EvmTxRequest[] one tx at a time, waiting for each receipt (let the wallet estimate gas — a pinned
 * gas can be rejected by the node). A dApp would instead pass the whole array to wallet_sendCalls (EIP-5792)
 * for an atomic, all-or-nothing batch; this sequential path is the headless functional check.
 */
export async function sendSequential(txs: readonly EvmTxRequest[], explorer?: string): Promise<string[]> {
  const w = wallet();
  const hashes: string[] = [];
  for (const tx of txs) {
    const hash = await w.sendTransaction({ to: tx.to as `0x${string}`, data: tx.data as `0x${string}`, value: tx.value });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`EVM tx reverted: ${hash}`);
    hashes.push(hash);
    if (explorer) console.log(`  ${hashes.length}. ${explorer}/tx/${hash}`); // EVM (blockscout) tx URL; number matches the step plan
  }
  return hashes;
}
