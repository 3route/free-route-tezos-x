'use client';
import { useEffect, useMemo, useState } from 'react';
import { useBalances, useTokens } from '@/lib/hooks';
import { useWallet } from '@/lib/wallet';
import { useUi } from '@/lib/ui';
import { XTZ, XTZ_ADDRESS, fromEvm, isXtz, threeRoute, toEvm } from '@/lib/sdk';
import type { ThreeRouteToken } from '@/lib/sdk';
import { fmtSig, fmtUnits, parseUnits } from '@/lib/format';
import { CFG } from '@/lib/config';
import { BridgeModal } from './BridgeModal';

const XTZ_FEE_BUFFER = 50_000n; // mutez left for op fees when "Max"-ing an XTZ swap

export function BridgePanel() {
  const { connected, michelsonAddress, connect } = useWallet();
  const { payTokens } = useTokens();
  const { xtz, erc } = useBalances();

  const tokens = useMemo<ThreeRouteToken[]>(() => [XTZ, ...payTokens], [payTokens]);
  const [fromAddr, setFromAddr] = useState(XTZ_ADDRESS);
  const [toAddr, setToAddr] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [open, setOpen] = useState(false);
  const [outPreview, setOutPreview] = useState<bigint | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const slippageBps = useUi((s) => s.slippageBps);

  // default To to USDC (fall back to the first ERC20) once the registry loads
  useEffect(() => {
    if (!toAddr && payTokens.length) setToAddr((payTokens.find((t) => t.symbol === 'USDC') ?? payTokens[0]).address);
  }, [toAddr, payTokens]);

  const byAddr = (a: string) => tokens.find((t) => t.address === a) ?? null;
  const fromTok = byAddr(fromAddr);
  const toTok = byAddr(toAddr);
  const balanceOf = (t: ThreeRouteToken): bigint => (isXtz(t.address) ? xtz ?? 0n : erc[t.address] ?? 0n);
  const amountBase = fromTok ? parseUnits(amountStr, fromTok.decimals) : null;
  const insufficient = amountBase !== null && fromTok ? amountBase > balanceOf(fromTok) : false;
  const samePair = fromAddr === toAddr;

  // live output preview in the To field — pricing-only getQuote (no calldata/approval); works before connecting.
  useEffect(() => {
    if (!fromTok || !toTok || samePair || amountBase === null || amountBase <= 0n) {
      setOutPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    const id = setTimeout(async () => {
      try {
        const q = await threeRoute.getQuote({ src: fromTok.address, dst: toTok.address, amount: toEvm(amountBase, fromTok.address), exactOut: false, slippagePercent: slippageBps / 100 });
        if (!cancelled) setOutPreview(fromEvm(q.dstAmount, toTok.address));
      } catch {
        if (!cancelled) setOutPreview(null);
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromAddr, toAddr, amountStr, slippageBps]);
  const canReview = connected && !!fromTok && !!toTok && amountBase !== null && amountBase > 0n && !samePair && !insufficient;

  const pickFrom = (a: string) => {
    if (a === toAddr) setToAddr(fromAddr);
    setFromAddr(a);
  };
  const pickTo = (a: string) => {
    if (a === fromAddr) setFromAddr(toAddr);
    setToAddr(a);
  };
  const flip = () => {
    setFromAddr(toAddr);
    setToAddr(fromAddr);
    setAmountStr('');
  };
  const setMax = () => {
    if (!fromTok) return;
    const bal = balanceOf(fromTok);
    const buf = isXtz(fromTok.address) ? XTZ_FEE_BUFFER : 0n;
    setAmountStr(fmtUnits(bal > buf ? bal - buf : 0n, fromTok.decimals, fromTok.decimals));
  };

  const tokenSelect = (value: string, onChange: (a: string) => void) => (
    <select className="input w-28 cursor-pointer" value={value} onChange={(e) => onChange(e.target.value)}>
      {tokens.map((t) => (
        <option key={t.address} value={t.address}>
          {t.symbol}
        </option>
      ))}
    </select>
  );

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Bridge · swap balance</h2>
        <a href={CFG.faucet} target="_blank" rel="noreferrer" className="btn-ghost text-xs">
          Get XTZ ↗
        </a>
      </div>

      <div className="card space-y-3">
        {/* From */}
        <div className="rounded-xl border border-edge bg-ink/40 p-3">
          <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500">
            <span className="label">From</span>
            {fromTok && (
              <button className="hover:text-slate-300" onClick={setMax}>
                balance {fmtUnits(balanceOf(fromTok), fromTok.decimals, fromTok.decimals)} · Max
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              className="input flex-1 font-mono text-lg"
              inputMode="decimal"
              placeholder="0.0"
              value={amountStr}
              onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setAmountStr(e.target.value)}
            />
            {tokenSelect(fromAddr, pickFrom)}
          </div>
        </div>

        {/* flip */}
        <div className="flex justify-center">
          <button className="btn-ghost h-8 w-8 rounded-full p-0" onClick={flip} title="flip">
            ⇅
          </button>
        </div>

        {/* To */}
        <div className="rounded-xl border border-edge bg-ink/40 p-3">
          <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500">
            <span className="label">To</span>
            {toTok && <span>balance {fmtUnits(balanceOf(toTok), toTok.decimals, toTok.decimals)}</span>}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 truncate font-mono text-lg text-slate-300">
              {previewing ? '…' : outPreview !== null && toTok ? `≈ ${fmtSig(outPreview, toTok.decimals, 6)}` : '0.0'}
            </div>
            {tokenSelect(toAddr, pickTo)}
          </div>
        </div>

        {insufficient && <div className="text-xs text-amber-400">Insufficient {fromTok?.symbol} balance.</div>}

        {connected ? (
          <button className="btn-primary w-full" disabled={!canReview} onClick={() => setOpen(true)}>
            {samePair ? 'Pick two different tokens' : 'Review swap'}
          </button>
        ) : (
          <button className="btn-primary w-full" onClick={() => void connect()}>
            Connect Temple
          </button>
        )}
      </div>

      {open && fromTok && toTok && amountBase !== null && (
        <BridgeModal src={fromTok} dst={toTok} amount={amountBase} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}
