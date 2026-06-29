// scripts/shared/client.ts — helpers shared by both the Michelson and EVM demo flows.
import { TezosToolkit } from '@taquito/taquito';
import { privateKeyToAccount } from 'viem/accounts';
import { FreeRouteTezosX, XTZ, tezosXPreviewnet } from '../../src/index.js';
import type { EvmAddress, FreeRouteToken } from '../../src/index.js';
import { env, need } from './env.js';

/** Native XTZ as a FreeRouteToken (mutez, 6 dp) — used by the swap flows alongside registry ERC20s. */
export const XTZ_TOKEN: FreeRouteToken = { address: XTZ.address, decimals: 6, symbol: 'XTZ', name: 'Tez' };

/** Resolve a swap token by symbol: native XTZ literal, or a registry ERC20 (throws if absent). */
export const resolveToken = (fr: FreeRouteTezosX, symbol: string): Promise<FreeRouteToken> =>
  symbol === 'XTZ' ? Promise.resolve(XTZ_TOKEN) : findToken(fr, symbol);

/** The EVM buyer's address derived from EVM_SK (null if not configured). Read-only — no signing. */
export const evmAddressFromEnv = (): EvmAddress | null =>
  env.EVM_SK ? privateKeyToAccount(env.EVM_SK as `0x${string}`).address : null;

/** A free-route client configured from .env (previewnet). Reads are shared; both sides build ops off it. */
export const newFreeRoute = (): FreeRouteTezosX =>
  new FreeRouteTezosX({ baseUrl: need('FREE_ROUTE_API'), apiKey: need('FREE_ROUTE_API_KEY'), network: tezosXPreviewnet });

/** Resolve a pay-token by symbol from the free-route registry (throws if absent). */
export const findToken = async (fr: FreeRouteTezosX, symbol: string): Promise<FreeRouteToken> => {
  const token = (await fr.getTokens()).find((t) => t.symbol === symbol);
  if (!token) throw new Error(`pay-token ${symbol} not in the free-route registry`);
  return token;
};

/** Read an objkt v4 ask's price (mutez) on-chain — the single source of truth for both buy flows. */
export const readAskPrice = async (michelsonRpc: string, marketplace: string, askId: string): Promise<bigint> => {
  const mp = await new TezosToolkit(michelsonRpc).contract.at(marketplace);
  const storage = (await mp.storage()) as { asks: { get(id: string): Promise<{ amount: { toString(): string } } | undefined> } };
  const ask = await storage.asks.get(askId);
  if (!ask) throw new Error(`ask #${askId} not found (already sold, or wrong marketplace)`);
  return BigInt(ask.amount.toString());
};
