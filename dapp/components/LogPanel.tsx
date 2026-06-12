'use client';
import { useLog, type LogLevel } from '@/lib/log';
import { fmtTime } from '@/lib/format';
import { CFG } from '@/lib/config';

const DOT: Record<LogLevel, string> = {
  info: 'bg-slate-400',
  success: 'bg-accent2',
  error: 'bg-rose-400',
  pending: 'bg-amber-400',
};

const isOpHash = (s?: string) => !!s && /^o[0-9A-Za-z]{50,}$/.test(s);

export function LogPanel() {
  const { entries, clear } = useLog();
  return (
    <div className="card flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300">Activity log</h3>
        <button className="text-xs text-slate-500 hover:text-slate-300" onClick={clear}>
          clear
        </button>
      </div>
      <div className="flex-1 space-y-2 overflow-auto pr-1 font-mono text-xs">
        {entries.length === 0 && <p className="text-slate-600">No activity yet.</p>}
        {entries.map((e) => (
          <div key={e.id} className="flex gap-2">
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${DOT[e.level]}`} />
            <div className="min-w-0">
              <div className="text-slate-300">
                <span className="text-slate-600">{fmtTime(e.ts)} </span>
                {e.msg}
              </div>
              {e.meta &&
                (isOpHash(e.meta) ? (
                  <a
                    href={`${CFG.explorer}/${e.meta}`}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all text-accent hover:underline"
                  >
                    {e.meta}
                  </a>
                ) : (
                  <div className="break-all text-slate-500">{e.meta}</div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
