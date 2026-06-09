'use client';
import { useState } from 'react';
import { useListings } from '@/lib/hooks';
import { useWallet } from '@/lib/wallet';
import { mutezToXtz, short } from '@/lib/format';
import { nftHue, nftName } from '@/lib/names';
import { BuyModal } from './BuyModal';
import type { Listing } from '@/lib/tzkt';

export function BuyerPanel() {
  const { listings, loading, refresh } = useListings();
  const { connected } = useWallet();
  const [sel, setSel] = useState<Listing | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Listings <span className="ml-1 text-sm text-slate-500">{listings.length}</span>
        </h2>
        <button className="btn-ghost" onClick={() => void refresh()}>
          ↻ Refresh
        </button>
      </div>

      {listings.length === 0 && (
        <div className="card text-sm text-slate-500">
          {loading ? 'Loading listings…' : 'No active listings. Switch to Seller mode to mint & list some.'}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {listings.map((l) => (
          <div key={l.askId} className="card flex flex-col p-3">
            <div
              className="mb-3 h-28 rounded-xl"
              style={{ background: `linear-gradient(135deg, hsl(${nftHue(l.tokenId)} 70% 55%), hsl(${(nftHue(l.tokenId) + 60) % 360} 70% 45%))` }}
            />
            <div className="truncate text-sm font-medium">{nftName(l.tokenId)}</div>
            <div className="font-mono text-[11px] text-slate-500">
              #{short(l.tokenId, 5)} · ask {l.askId}
            </div>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-lg font-semibold">{mutezToXtz(l.priceMutez, 4)}</span>
              <span className="text-xs text-slate-500">XTZ</span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-600">seller {short(l.seller, 5)}</div>
            <button className="btn-primary mt-3" disabled={!connected} onClick={() => setSel(l)}>
              Buy
            </button>
          </div>
        ))}
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
