'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { XTZ_ADDRESS, isXtz, threeRoute, xtzMutezToWei } from './sdk';
import type { ThreeRouteToken } from './sdk';
import { fetchErc20Balance, fetchListings, fetchOwned, fetchXtzBalance, type Listing, type OwnedToken } from './tzkt';
import { useUi } from './ui';
import { fmtSig } from './format';

// 3route token registry (payment options live here).
export function useTokens() {
  const [tokens, setTokens] = useState<ThreeRouteToken[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    threeRoute
      .getTokens()
      // stable, deterministic order — the server returns tokens in an arbitrary (map) order that
      // varies per fetch, and each useTokens() instance fetches independently. Sort by symbol so the
      // list looks identical everywhere and across reloads.
      .then((t) => setTokens([...t].sort((a, b) => a.symbol.localeCompare(b.symbol))))
      .catch((e: Error) => setError(e.message));
  }, []);
  // payment/quote tokens = real ERC20s: drop the native-XTZ registry entry (the native currency itself —
  // redundant with the XTZ option / pointless to swap XTZ->XTZ). Memoized so its identity is stable across
  // renders — otherwise dependent effects (balances, rate) would refetch on every render.
  const payTokens = useMemo(() => tokens.filter((t) => !isXtz(t.address)), [tokens]);
  return { tokens, payTokens, error };
}

// Michelson-address XTZ balance + alias ERC20 balances.
export function useBalances(aliasAddress: string | null, michelsonAddress: string | null, payTokens: ThreeRouteToken[]) {
  const [xtz, setXtz] = useState<bigint | null>(null);
  const [erc, setErc] = useState<Record<string, bigint>>({});
  const [loading, setLoading] = useState(false);
  const bump = useUi((s) => s.bump);

  const refresh = useCallback(async () => {
    if (!aliasAddress || !michelsonAddress) return;
    setLoading(true);
    try {
      setXtz(await fetchXtzBalance(michelsonAddress).catch(() => 0n));
      const entries = await Promise.all(
        payTokens.map(async (t) => [t.address, await fetchErc20Balance(t.address, aliasAddress).catch(() => 0n)] as const),
      );
      setErc(Object.fromEntries(entries));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aliasAddress, michelsonAddress, payTokens, bump]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { xtz, erc, loading, refresh };
}

// Live price-currency converter. Pulls ONE exact-out rate (token per 1 XTZ) from the 3route /swap
// endpoint and applies it to every listing; auto-refreshes every 30s. currency 'XTZ' = no conversion.
const REF_XTZ_MUTEZ = 1_000_000n; // 1 XTZ
const REF_XTZ_WEI = xtzMutezToWei(REF_XTZ_MUTEZ); // 1 XTZ in wei (EVM side)

export function usePriceCurrency(payTokens: ThreeRouteToken[]) {
  const currency = useUi((s) => s.currency); // global — shared with the buy modal
  const setCurrency = useUi((s) => s.setCurrency);
  const [rate, setRate] = useState<bigint | null>(null); // token base units per 1 XTZ
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const token = payTokens.find((t) => t.address === currency) ?? null;

  // default to the first pay-token once the registry loads (runs once; user can switch / toggle to XTZ after)
  useEffect(() => {
    if (!currency && payTokens.length) setCurrency(payTokens[0].address);
  }, [currency, payTokens]);

  useEffect(() => {
    if (!token) {
      setRate(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const fetchRate = async () => {
      try {
        // a rate quote needs no address — from/receiver are optional on getQuote.
        const q = await threeRoute.getQuote({ src: token.address, dst: XTZ_ADDRESS, amount: REF_XTZ_WEI, exactOut: true, slippagePercent: 1 });
        if (!cancelled) {
          setRate(BigInt(q.srcAmount));
          setUpdatedAt(Date.now());
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    void fetchRate();
    const id = setInterval(fetchRate, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token]);

  // listing price (mutez) -> selected token base units, at the shared rate only (NO slippage buffer). The card
  // is an estimate; the binding amount (with the slippage buffer + a real per-ask getSwap) lives in the modal.
  const convert = (priceMutez: string | number): bigint | null => {
    if (!token || rate === null) return null;
    return (BigInt(priceMutez) * rate) / REF_XTZ_MUTEZ;
  };

  // bidirectional rate label: "1 XTZ ≈ x SYM · 1 SYM ≈ y XTZ"
  let rateLabel: string | null = null;
  if (token && rate !== null && rate > 0n) {
    const xtzToToken = fmtSig(rate, token.decimals, 4); // SYM per 1 XTZ
    const tokenToXtzMutez = (REF_XTZ_MUTEZ * 10n ** BigInt(token.decimals)) / rate; // mutez per 1 SYM
    rateLabel = `1 XTZ ≈ ${xtzToToken} ${token.symbol} · 1 ${token.symbol} ≈ ${fmtSig(tokenToXtzMutez, 6, 4)} XTZ`;
  }

  return { currency, setCurrency, token, rate, convert, rateLabel, updatedAt, error };
}

// Active XTZ-priced listings for the test FA2.
export function useListings() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(false);
  const bump = useUi((s) => s.bump);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setListings(await fetchListings());
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bump]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { listings, loading, refresh };
}

// Tokens owned by the connected Michelson address.
export function useOwned(michelsonAddress: string | null) {
  const [owned, setOwned] = useState<OwnedToken[]>([]);
  const [loading, setLoading] = useState(false);
  const bump = useUi((s) => s.bump);
  const refresh = useCallback(async () => {
    if (!michelsonAddress) {
      setOwned([]);
      return;
    }
    setLoading(true);
    try {
      setOwned(await fetchOwned(michelsonAddress));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [michelsonAddress, bump]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { owned, loading, refresh };
}
