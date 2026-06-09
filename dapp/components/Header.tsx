'use client';
import { useWallet } from '@/lib/wallet';
import { useUi } from '@/lib/ui';
import { useBalances, useTokens } from '@/lib/hooks';
import { fmtUnits, mutezToXtz, short } from '@/lib/format';
import { CFG } from '@/lib/config';

export function Header() {
  const { connected, address, alias, connect, disconnect, connecting } = useWallet();
  const { mode, setMode } = useUi();
  const { payTokens } = useTokens();
  const { xtz, erc, loading } = useBalances(alias, address, payTokens);

  return (
    <header className="sticky top-0 z-20 border-b border-edge bg-ink/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-5 py-3">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent/20 text-accent">◈</div>
          <div>
            <div className="text-sm font-semibold leading-tight">objkt · pay with any ERC20</div>
            <div className="text-[11px] text-slate-500">Tezos X previewnet · one atomic op-group</div>
          </div>
        </div>

        {/* mode toggle */}
        <div className="flex rounded-xl border border-edge p-0.5">
          {(['buyer', 'seller'] as const).map((mItem) => (
            <button
              key={mItem}
              onClick={() => setMode(mItem)}
              className={`rounded-lg px-3.5 py-1.5 text-sm capitalize transition ${
                mode === mItem ? 'bg-accent text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {mItem}
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {connected && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="chip" title="tz1 balance">
                <span className="text-slate-500">XTZ</span>
                <span className="font-mono">{xtz === null ? '…' : mutezToXtz(xtz, 4)}</span>
              </span>
              {payTokens.map((t) => (
                <span key={t.address} className="chip" title={`alias ${t.symbol}`}>
                  <span className="text-slate-500">{t.symbol}</span>
                  <span className="font-mono">{erc[t.address] === undefined ? '…' : fmtUnits(erc[t.address] ?? 0n, t.decimals, 3)}</span>
                </span>
              ))}
              {loading && <span className="text-[11px] text-slate-600">refreshing…</span>}
            </div>
          )}

          {connected ? (
            <div className="flex items-center gap-2">
              <span className="chip" title={`${address}\nalias ${alias}`}>
                <span className="h-2 w-2 rounded-full bg-accent2" />
                <span className="font-mono">{short(address ?? '')}</span>
              </span>
              <button className="btn-ghost" onClick={() => void disconnect()}>
                Disconnect
              </button>
            </div>
          ) : (
            <button className="btn-primary" onClick={() => void connect()} disabled={connecting}>
              {connecting ? 'Connecting…' : 'Connect Temple'}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
