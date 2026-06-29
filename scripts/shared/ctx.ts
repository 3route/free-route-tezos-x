// scripts/shared/ctx.ts — shared building blocks for the demo flows and the e2e suite. The flow functions
// (runSetup / buyMichelson / buyEvm / bridgeMichelson / bridgeEvm) take explicit args, so they reuse one
// implementation across the CLI wrappers (which read .env) and the e2e tests (which build a Ctx once).
import { RpcForger, TezosToolkit } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import { privateKeyToAccount } from 'viem/accounts';
import { FreeRouteTezosX, michelsonToEvmAlias, tezosXPreviewnet } from '../../src/index.js';
import type { EvmAddress } from '../../src/index.js';
import { pathToFileURL } from 'node:url';
import { need } from './env.js';

/** Optional progress sink — the CLI wrappers pass `console.log`; the e2e tests leave it silent. */
export type Log = (line: string) => void;
export const noop: Log = () => undefined;

/** True when `moduleUrl` (import.meta.url) is the process entrypoint — lets a file be both importable and runnable. */
export const isMain = (moduleUrl: string): boolean =>
  process.argv[1] !== undefined && moduleUrl === pathToFileURL(process.argv[1]).href;

/** A Taquito toolkit for an InMemorySigner (scripts only). previewnet rejects local forging → RpcForger. */
export const makeToolkit = (rpc: string, sk: string): TezosToolkit => {
  const tk = new TezosToolkit(rpc);
  tk.setProvider({ signer: new InMemorySigner(sk) });
  tk.setForgerProvider(tk.getFactory(RpcForger)());
  return tk;
};

/** Poll `read` until it reaches `min` (or the tries run out) — the EVM-side balance settles a bit after the Tezos op. */
export const poll = async (read: () => Promise<bigint>, min: bigint, tries = 15, gapMs = 1000): Promise<bigint> => {
  let v = await read();
  for (let i = 0; i < tries && v < min; i++) {
    await new Promise((r) => setTimeout(r, gapMs));
    v = await read();
  }
  return v;
};

/** Full context for the e2e suite — requires every env var the flows need (incl. EVM_SK + the deployed fixtures). */
export interface Ctx {
  michelsonRpc: string;
  evmRpc: string;
  tzktExplorer: string;
  evmExplorer: string;
  freeRoute: FreeRouteTezosX;
  buyer: TezosToolkit;
  buyerAddress: string;
  buyerAlias: EvmAddress;
  seller: TezosToolkit;
  sellerAddress: string;
  evmAccount: EvmAddress;
  fa2: string;
  objkt: string;
}

/** Build the e2e context from .env. Throws (via `need`) with an actionable message if anything is missing. */
export const buildCtx = async (): Promise<Ctx> => {
  const michelsonRpc = need('MICHELSON_RPC');
  const buyer = makeToolkit(michelsonRpc, need('BUYER_MICHELSON_SK'));
  const seller = makeToolkit(michelsonRpc, need('SELLER_MICHELSON_SK'));
  const buyerAddress = await buyer.signer.publicKeyHash();
  const sellerAddress = await seller.signer.publicKeyHash();
  return {
    michelsonRpc,
    evmRpc: need('EVM_RPC'),
    tzktExplorer: need('TZKT_EXPLORER'),
    evmExplorer: need('EVM_EXPLORER'),
    freeRoute: new FreeRouteTezosX({ network: tezosXPreviewnet, baseUrl: need('FREE_ROUTE_API'), apiKey: need('FREE_ROUTE_API_KEY') }),
    buyer,
    buyerAddress,
    buyerAlias: michelsonToEvmAlias(buyerAddress),
    seller,
    sellerAddress,
    evmAccount: privateKeyToAccount(need('EVM_SK') as `0x${string}`).address, // require EVM_SK (e2e covers both sides)
    fa2: need('TEST_FA2'),
    objkt: need('OBJKT_MARKETPLACE'),
  };
};
