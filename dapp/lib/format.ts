// Display formatting helpers.
export function fmtUnits(raw: bigint | string | number, decimals: number, maxFrac = 4): string {
  const v = typeof raw === 'bigint' ? raw : BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = v % base;
  if (frac === 0n) return whole.toString();
  const f = frac.toString().padStart(decimals, '0').slice(0, maxFrac).replace(/0+$/, '');
  return f ? `${whole}.${f}` : whole.toString();
}

export const mutezToXtz = (mutez: bigint | string | number, maxFrac = 6): string => fmtUnits(mutez, 6, maxFrac);

export function short(addr: string, n = 6): string {
  return addr.length > 2 * n ? `${addr.slice(0, n)}…${addr.slice(-4)}` : addr;
}

export const fmtTime = (ts: number): string => new Date(ts).toLocaleTimeString();
