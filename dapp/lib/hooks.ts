'use client';
import { useCallback, useEffect, useState } from 'react';
import { NATIVE_XTZ, threeRoute } from './sdk';
import type { ThreeRouteToken } from './sdk';
import { fetchErc20Balance, fetchListings, fetchXtzBalance, type Listing } from './tzkt';
import { useUi } from './ui';

// 3route token registry (payment options live here).
export function useTokens() {
  const [tokens, setTokens] = useState<ThreeRouteToken[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    threeRoute
      .getTokens()
      .then(setTokens)
      .catch((e: Error) => setError(e.message));
  }, []);
  // payment tokens = everything except the native-XTZ sentinel
  const payTokens = tokens.filter((t) => t.address.toLowerCase() !== NATIVE_XTZ.toLowerCase());
  return { tokens, payTokens, error };
}

// tz1 XTZ balance + alias ERC20 balances.
export function useBalances(alias: string | null, tz1: string | null, payTokens: ThreeRouteToken[]) {
  const [xtz, setXtz] = useState<bigint | null>(null);
  const [erc, setErc] = useState<Record<string, bigint>>({});
  const [loading, setLoading] = useState(false);
  const bump = useUi((s) => s.bump);

  const refresh = useCallback(async () => {
    if (!alias || !tz1) return;
    setLoading(true);
    try {
      setXtz(await fetchXtzBalance(tz1).catch(() => 0n));
      const entries = await Promise.all(
        payTokens.map(async (t) => [t.address, await fetchErc20Balance(t.address, alias).catch(() => 0n)] as const),
      );
      setErc(Object.fromEntries(entries));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alias, tz1, payTokens, bump]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { xtz, erc, loading, refresh };
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
