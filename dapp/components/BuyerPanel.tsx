'use client';
import { useEffect, useMemo, useState } from 'react';
import { useListings, usePriceCurrency, useTokens } from '@/lib/hooks';
import { useWallet } from '@/lib/wallet';
import { fmtSig, mutezToXtz, short } from '@/lib/format';
import { nftHue, nftName } from '@/lib/names';
import { BuyModal } from './BuyModal';
import { Select, type SelectOption } from './Select';
import type { Listing } from '@/lib/tzkt';

type SortKey = 'new' | 'old' | 'price-asc' | 'price-desc' | 'name';
const SORTS: SelectOption<SortKey>[] = [
  { value: 'new', label: 'Newest' },
  { value: 'old', label: 'Oldest' },
  { value: 'price-asc', label: 'Price ↑' },
  { value: 'price-desc', label: 'Price ↓' },
  { value: 'name', label: 'Name A–Z' },
];

export function BuyerPanel() {
  const { listings, loading, refresh } = useListings();
  const { connected, alias } = useWallet();
  const { payTokens } = useTokens();
  const { currency, setCurrency, token, convert, rateLabel, updatedAt, error } = usePriceCurrency(payTokens, alias);
  const [sel, setSel] = useState<Listing | null>(null);
  const [sort, setSort] = useState<SortKey>('new');

  const sorted = useMemo(() => {
    const arr = [...listings];
    const price = (l: Listing) => BigInt(l.priceMutez);
    switch (sort) {
      case 'new':
        return arr.sort((a, b) => Number(b.askId) - Number(a.askId));
      case 'old':
        return arr.sort((a, b) => Number(a.askId) - Number(b.askId));
      case 'price-asc':
        return arr.sort((a, b) => (price(a) < price(b) ? -1 : price(a) > price(b) ? 1 : 0));
      case 'price-desc':
        return arr.sort((a, b) => (price(b) < price(a) ? -1 : price(b) > price(a) ? 1 : 0));
      case 'name':
        return arr.sort((a, b) => nftName(a.tokenId).localeCompare(nftName(b.tokenId)));
      default:
        return arr;
    }
  }, [listings, sort]);

  // tick every second so the "updated Ns ago" label stays fresh
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ago = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null;

  const currencies = ['XTZ', ...payTokens.map((t) => t.address)];
  const symbolOf = (c: string) => (c === 'XTZ' ? 'XTZ' : payTokens.find((t) => t.address === c)?.symbol ?? '?');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Listings <span className="ml-1 text-sm text-slate-500">{listings.length}</span>
        </h2>
        <div className="flex items-center gap-2">
          <span className="label">Sort</span>
          <Select value={sort} options={SORTS} onChange={setSort} />
          <button className="btn-ghost" onClick={() => void refresh()}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* currency switcher */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="label">Show price in</span>
        {currencies.map((c) => (
          <button
            key={c}
            onClick={() => setCurrency(c)}
            className={`chip ${currency === c ? 'border-accent text-accent' : ''}`}
          >
            {symbolOf(c)}
          </button>
        ))}
        {currency !== 'XTZ' && (
          <span className="ml-1 text-[11px] text-slate-500">
            {error ? (
              <span className="text-rose-400">rate unavailable</span>
            ) : (
              <>
                {rateLabel ? <span className="text-slate-400">{rateLabel}</span> : 'quoting…'} · via 3route ·
                auto-refresh 30s{ago !== null ? ` · updated ${ago}s ago` : ''}
              </>
            )}
          </span>
        )}
      </div>

      {listings.length === 0 && (
        <div className="card text-sm text-slate-500">
          {loading ? 'Loading listings…' : 'No active listings. Switch to Seller mode to mint & list some.'}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {sorted.map((l) => {
          const inToken = currency !== 'XTZ' ? convert(l.priceMutez) : null;
          return (
            <div key={l.askId} className="card flex flex-col p-3">
              <div
                className="mb-3 h-28 rounded-xl"
                style={{ background: `linear-gradient(135deg, hsl(${nftHue(l.tokenId)} 70% 55%), hsl(${(nftHue(l.tokenId) + 60) % 360} 70% 45%))` }}
              />
              <div className="truncate text-sm font-medium">{nftName(l.tokenId)}</div>
              <div className="font-mono text-[11px] text-slate-500">
                #{short(l.tokenId, 5)} · ask {l.askId}
              </div>

              {currency === 'XTZ' || !token ? (
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-lg font-semibold">{mutezToXtz(l.priceMutez, 4)}</span>
                  <span className="text-xs text-slate-500">XTZ</span>
                </div>
              ) : (
                <div className="mt-2">
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-semibold">
                      {inToken === null ? '…' : `≈ ${fmtSig(inToken, token.decimals, 4)}`}
                    </span>
                    <span className="text-xs text-slate-500">{token.symbol}</span>
                  </div>
                  <div className="text-[11px] text-slate-600">{mutezToXtz(l.priceMutez, 4)} XTZ</div>
                </div>
              )}

              <div className="mt-0.5 text-[11px] text-slate-600">seller {short(l.seller, 5)}</div>
              <button className="btn-primary mt-3" disabled={!connected} onClick={() => setSel(l)}>
                Buy
              </button>
            </div>
          );
        })}
      </div>

      {sel && (
        <BuyModal
          listing={sel}
          onClose={() => {
            setSel(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}
