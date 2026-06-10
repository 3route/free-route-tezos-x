'use client';
import { useEffect, useState } from 'react';
import type { ParamsWithKind } from '@taquito/taquito';
import { useWallet } from '@/lib/wallet';
import { useUi } from '@/lib/ui';
import { useBalances, useTokens } from '@/lib/hooks';
import { buildBuyBatch, sendChunked, type BuyIntent } from '@/lib/ops';
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
  { label: '0.1%', bps: 10 },
  { label: '0.5%', bps: 50 },
  { label: '1%', bps: 100 },
];
const MIN_SLIPPAGE_BPS = 5; // 0.05%
const MAX_SLIPPAGE_BPS = 4900; // 49%

export function BuyModal({ listing, onClose }: { listing: Listing; onClose: () => void }) {
  const { tezos, michelsonAddress, aliasAddress } = useWallet();
  const refresh = useUi((s) => s.refresh);
  const { payTokens } = useTokens();
  const { erc } = useBalances(aliasAddress, michelsonAddress, payTokens);

  // selected pay-token comes from the GLOBAL currency (shared with the listing switcher); fall back to
  // the first token when the listing is in XTZ-only mode.
  const currency = useUi((s) => s.currency);
  const setCurrency = useUi((s) => s.setCurrency);
  const token = payTokens.find((t) => t.address === currency) ?? payTokens[0] ?? null;
  const slippageBps = useUi((s) => s.slippageBps); // global slippage (shared with the listing cards)
  const setSlippageBps = useUi((s) => s.setSlippageBps);
  // raw % text for the custom field ('' = a preset is active); pre-fill if the global value isn't a preset
  const [customSlippage, setCustomSlippage] = useState(() =>
    SLIPPAGES.some((s) => s.bps === slippageBps) ? '' : String(slippageBps / 100),
  );
  const [intent, setIntent] = useState<BuyIntent | null>(null);
  const [ops, setOps] = useState<ParamsWithKind[] | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [buying, setBuying] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const priceMutez = Number(listing.priceMutez);

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
      <div className="card max-h-[90vh] w-full max-w-lg overflow-y-auto" onClick={(e) => e.stopPropagation()}>
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

        {/* pay token — compact chips, like the listing switcher */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="label">Pay with</span>
          {payTokens.map((t) => (
            <button
              key={t.address}
              onClick={() => setCurrency(t.address)}
              className={`chip ${token?.address === t.address ? 'border-accent text-accent' : ''}`}
            >
              {t.symbol}
            </button>
          ))}
        </div>

        {/* slippage */}
        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="label">Slippage</span>
            {SLIPPAGES.map((s) => (
              <button
                key={s.bps}
                onClick={() => {
                  setSlippageBps(s.bps);
                  setCustomSlippage('');
                }}
                className={`chip ${!customSlippage && slippageBps === s.bps ? 'border-accent text-accent' : ''}`}
              >
                {s.label}
              </button>
            ))}
            <span className={`chip gap-1 ${customSlippage ? 'border-accent text-accent' : ''}`}>
              <input
                type="number"
                step="0.1"
                min={MIN_SLIPPAGE_BPS / 100}
                max={MAX_SLIPPAGE_BPS / 100}
                placeholder="custom"
                value={customSlippage}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') {
                    setCustomSlippage('');
                    return;
                  }
                  let pct = Number(raw);
                  if (!Number.isFinite(pct) || pct < 0) return; // ignore non-numeric / negative
                  const maxPct = MAX_SLIPPAGE_BPS / 100;
                  // cap the entered value so you can't type beyond the allowed range
                  const text = pct > maxPct ? ((pct = maxPct), String(maxPct)) : raw;
                  setCustomSlippage(text);
                  if (pct > 0) setSlippageBps(Math.max(MIN_SLIPPAGE_BPS, Math.round(pct * 100)));
                }}
                className="w-14 bg-transparent text-right outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              />
              %
            </span>
          </div>
          {slippageBps > 500 && <p className="mt-1.5 text-[11px] text-amber-400">High slippage — you may overpay.</p>}
          {slippageBps < 10 && <p className="mt-1.5 text-[11px] text-slate-500">Very low — the swap may revert on a thin pool.</p>}
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
