'use client';
import { useUi, type Mode } from '@/lib/ui';
import { WalletMenu } from './WalletMenu';

const MODES: Array<{ key: Mode; label: string }> = [
  { key: 'buyer', label: 'Buyer' },
  { key: 'seller', label: 'Seller' },
  { key: 'owned', label: 'My NFTs' },
];

export function Header() {
  const { mode, setMode } = useUi();

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
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm transition ${
                mode === m.key ? 'bg-accent text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="ml-auto">
          <WalletMenu />
        </div>
      </div>
    </header>
  );
}
