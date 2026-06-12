'use client';
import { useEffect, useRef, useState } from 'react';
import { useWallet } from '@/lib/wallet';
import { useBalances, useTokens } from '@/lib/hooks';
import { fmtSig, mutezToXtz, short } from '@/lib/format';
import { CFG } from '@/lib/config';

const tzktLink = (a: string) => `${CFG.explorer}/${a}`;
const evmLink = (a: string) => `${CFG.evmExplorer}/address/${a}`;

// Header wallet control: Connect button when disconnected; otherwise an address pill that opens a
// dropdown with balances + a Disconnect button.
export function WalletMenu() {
  const { connected, michelsonAddress, aliasAddress, connect, disconnect, connecting } = useWallet();
  const { payTokens } = useTokens();
  const { xtz, erc, loading, refresh } = useBalances();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!connected) {
    return (
      <button className="btn-primary" onClick={() => void connect()} disabled={connecting}>
        {connecting ? 'Connecting…' : 'Connect Temple'}
      </button>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button className="btn-ghost" onClick={() => setOpen((o) => !o)}>
        <span className="h-2 w-2 rounded-full bg-accent2" />
        <span className="font-mono">{short(michelsonAddress ?? '')}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className={`text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1.5 w-72 rounded-xl border border-edge bg-panel p-3 shadow-xl shadow-black/50">
          <div className="mb-2 flex items-center justify-between">
            <span className="label">Balances</span>
            <button className="text-xs text-slate-500 hover:text-slate-300" onClick={() => void refresh()} title="refresh">
              {loading ? '…' : '↻'}
            </button>
          </div>

          <div className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">XTZ</span>
              <span className="font-mono">{xtz === null ? '…' : mutezToXtz(xtz, 4)}</span>
            </div>
            {payTokens.map((t) => (
              <div key={t.address} className="flex items-center justify-between">
                <span className="text-slate-400">{t.symbol}</span>
                <span className="font-mono">{erc[t.address] === undefined ? '…' : fmtSig(erc[t.address] ?? 0n, t.decimals, 4)}</span>
              </div>
            ))}
          </div>

          <div className="mt-3 space-y-1 border-t border-edge pt-2 text-[11px] text-slate-500">
            <div className="flex items-center justify-between">
              <span>Michelson address</span>
              <a href={tzktLink(michelsonAddress ?? '')} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline" title={michelsonAddress ?? ''}>
                {short(michelsonAddress ?? '', 6)}
              </a>
            </div>
            <div className="flex items-center justify-between">
              <span>EVM alias</span>
              <a href={evmLink(aliasAddress ?? '')} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline" title={aliasAddress ?? ''}>
                {short(aliasAddress ?? '', 6)}
              </a>
            </div>
          </div>

          <button
            className="btn-ghost mt-3 w-full text-rose-300 hover:bg-rose-500/10"
            onClick={() => {
              setOpen(false);
              void disconnect();
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
