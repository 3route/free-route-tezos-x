'use client';
import { useEffect, useState } from 'react';
import type { ParamsWithKind } from '@taquito/taquito';
import { useWallet } from '@/lib/wallet';
import { useUi } from '@/lib/ui';
import { useBalances, useTokens } from '@/lib/hooks';
import { buildBuyBatch, sendChunked, type BuyIntent } from '@/lib/ops';
import type { ThreeRouteToken } from '@/lib/sdk';
import { fmtSig, mutezToXtz, short } from '@/lib/format';
import { nftHue, nftName } from '@/lib/names';
import { log } from '@/lib/log';
import { CFG } from '@/lib/config';
import type { Listing } from '@/lib/tzkt';

// address -> explorer link. Michelson side (tz/KT) -> tzkt; EVM (0x) -> Blockscout.
function Addr({ value, len = 5 }: { value: string; len?: number }) {
  if (!value) return null;
  const isTezos = value.startsWith('tz') || value.startsWith('KT');
  const href = isTezos ? `${CFG.explorer}/${value}` : `${CFG.evmExplorer}/address/${value}`;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:underline" title={value}>
      {short(value, len)}
    </a>
  );
}

const Spinner = () => <div className="h-6 w-6 animate-spin rounded-full border-2 border-edge border-t-accent" />;

const SLIPPAGES = [
  { label: '0.5%', bps: 50 },
  { label: '1%', bps: 100 },
  { label: '2%', bps: 200 },
  { label: '3%', bps: 300 },
];

export function BuyModal({ listing, initialCurrency, onClose }: { listing: Listing; initialCurrency?: string; onClose: () => void }) {
  const { tezos, michelsonAddress, aliasAddress } = useWallet();
  const refresh = useUi((s) => s.refresh);
  const { payTokens } = useTokens();
  const { erc } = useBalances(aliasAddress, michelsonAddress, payTokens);

  const [token, setToken] = useState<ThreeRouteToken | null>(null);
  const [slippageBps, setSlippageBps] = useState(200);
  const [intent, setIntent] = useState<BuyIntent | null>(null);
  const [ops, setOps] = useState<ParamsWithKind[] | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [buying, setBuying] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const priceMutez = Number(listing.priceMutez);

  useEffect(() => {
    if (!token && payTokens.length) setToken(payTokens.find((t) => t.address === initialCurrency) ?? payTokens[0]);
  }, [payTokens, token, initialCurrency]);

  // (re)quote whenever the pay token or slippage changes
  useEffect(() => {
    if (!tezos || !michelsonAddress || !token) return;
    let cancelled = false;
    setQuoting(true);
    setErr(null);
    setOps(null); // never allow sending stale ops mid-requote (Buy is also disabled while quoting)
    // keep the previous `intent` on screen (stale-while-revalidate) so the panel doesn't collapse/jump
    buildBuyBatch(tezos, michelsonAddress, { askId: listing.askId, tokenId: listing.tokenId, priceMutez }, token, slippageBps)
      .then(({ ops: o, intent: it }) => {
        if (!cancelled) {
          setOps(o);
          setIntent(it);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setErr(e.message);
          setIntent(null);
        }
      })
      .finally(() => !cancelled && setQuoting(false));
    return () => {
      cancelled = true;
    };
  }, [tezos, michelsonAddress, token, slippageBps, listing, priceMutez]);

  const bal = token ? erc[token.address] ?? 0n : 0n;
  const need = intent ? BigInt(intent.payAmount) : 0n;
  const enough = !intent || bal >= need;

  async function confirm() {
    if (!tezos || !ops || !token) return;
    setBuying(true);
    setErr(null);
    try {
      log.pending(`Buying ask#${listing.askId} with ${token.symbol}…`);
      const hashes = await sendChunked(tezos, ops, (h) => log.ok('operation confirmed', h));
      log.ok(`Bought "${nftName(listing.tokenId)}" → delivered to your Michelson address`, hashes.join(' '));
      refresh();
      onClose();
    } catch (e) {
      const msg = (e as Error).message;
      log.err('Purchase failed', msg);
      setErr(msg);
    } finally {
      setBuying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="card w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="mb-4 flex items-center gap-3">
          <div
            className="h-14 w-14 rounded-xl"
            style={{ background: `linear-gradient(135deg, hsl(${nftHue(listing.tokenId)} 70% 55%), hsl(${(nftHue(listing.tokenId) + 60) % 360} 70% 45%))` }}
          />
          <div className="min-w-0">
            <div className="font-semibold">{nftName(listing.tokenId)}</div>
            <div className="font-mono text-[11px] text-slate-500">
              ask {listing.askId} · #{short(listing.tokenId, 6)}
            </div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-xl font-semibold">{mutezToXtz(priceMutez, 4)}</div>
            <div className="text-xs text-slate-500">XTZ price</div>
          </div>
        </div>

        {/* pay token */}
        <div className="label mb-1.5">Pay with</div>
        <div className="mb-4 grid grid-cols-3 gap-2">
          {payTokens.map((t) => (
            <button
              key={t.address}
              onClick={() => setToken(t)}
              className={`rounded-xl border px-3 py-2 text-left transition ${
                token?.address === t.address ? 'border-accent bg-accent/10' : 'border-edge hover:bg-white/5'
              }`}
            >
              <div className="text-sm font-medium">{t.symbol}</div>
              <div className="font-mono text-[11px] text-slate-500">{fmtSig(erc[t.address] ?? 0n, t.decimals, 3)}</div>
            </button>
          ))}
        </div>

        {/* slippage */}
        <div className="mb-4 flex items-center gap-2">
          <span className="label">Slippage</span>
          {SLIPPAGES.map((s) => (
            <button
              key={s.bps}
              onClick={() => setSlippageBps(s.bps)}
              className={`chip ${slippageBps === s.bps ? 'border-accent text-accent' : ''}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* intent */}
        <div className="rounded-xl border border-edge bg-ink/50 p-3 text-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="label">Intent</span>
          </div>
          <div className="relative min-h-[15rem]">
            {err && !intent && (
              <div className="grid h-[15rem] place-items-center text-center text-xs text-rose-400">{err}</div>
            )}
            {intent && token && (
            <div className={`space-y-2 transition-opacity ${quoting ? 'opacity-40' : 'opacity-100'}`}>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">
                  You pay <span className="text-[10px] uppercase tracking-wide text-slate-600">exact</span>
                </span>
                <span className="font-mono">
                  {fmtSig(intent.payAmount, token.decimals, 6)} {token.symbol}
                </span>
              </div>
              <div className="flex items-start justify-between">
                <span className="text-slate-400">You receive</span>
                <span className="text-right font-mono">
                  <span className="block">
                    ≈ {mutezToXtz(intent.expectedOutMutez, 6)} XTZ{' '}
                    <span className="text-[10px] uppercase tracking-wide text-slate-600">expected</span>
                  </span>
                  <span className="block text-xs text-slate-500">≥ {mutezToXtz(intent.minOutMutez, 6)} XTZ guaranteed</span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">NFT price</span>
                <span className="font-mono">{mutezToXtz(priceMutez, 6)} XTZ</span>
              </div>
              <div className="flex items-start justify-between">
                <span className="text-slate-400">Change → your Michelson address</span>
                <span className="text-right font-mono">
                  <span className="block">
                    ≈ {mutezToXtz(intent.changeMutez, 6)} XTZ{' '}
                    <span className="text-[10px] uppercase tracking-wide text-slate-600">expected</span>
                  </span>
                  <span className="block text-xs text-slate-500">
                    ≥ 0, set on-chain · <Addr value={michelsonAddress ?? ''} len={6} />
                  </span>
                </span>
              </div>
              <div className="flex items-start justify-between">
                <span className="text-slate-400">Slippage</span>
                <span className="max-w-[60%] text-right text-xs text-slate-500">
                  {intent.slippageBps / 100}% — if output &lt; {mutezToXtz(intent.minOutMutez, 6)} XTZ the purchase reverts ({token.symbol} refunded)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Route</span>
                <span className="font-mono text-xs">
                  {token.symbol} → XTZ · 3route <Addr value={intent.router} len={5} />
                </span>
              </div>
              <div className="mt-2 border-t border-edge pt-2">
                <div className="label mb-1">One signature · atomic op-group</div>
                <ol className="space-y-1 text-xs text-slate-400">
                  {intent.steps.map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-slate-600">{i + 1}.</span>
                      <span>
                        <span className="text-slate-300">{s.kind}</span> — {s.detail}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
              {!enough && (
                <div className="mt-1 text-xs text-amber-400">
                  Alias balance ({fmtSig(bal, token.decimals, 4)} {token.symbol}) is below the required amount.
                </div>
              )}
            </div>
            )}
            {quoting && (
              <div className="absolute inset-0 grid place-items-center">
                <Spinner />
              </div>
            )}
          </div>
        </div>

        {/* actions */}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={buying}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => void confirm()} disabled={!ops || buying || quoting || !enough}>
            {buying ? 'Signing…' : `Buy with ${token?.symbol ?? ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
