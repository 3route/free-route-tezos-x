// On-site activity log (shown in the LogPanel). Newest first.
import { create } from 'zustand';

export type LogLevel = 'info' | 'success' | 'error' | 'pending';
export interface LogEntry {
  id: number;
  ts: number;
  level: LogLevel;
  msg: string;
  meta?: string; // op hash, error detail, link, etc.
}

interface LogState {
  entries: LogEntry[];
  push: (level: LogLevel, msg: string, meta?: string) => void;
  clear: () => void;
}

let seq = 0;
export const useLog = create<LogState>((set) => ({
  entries: [],
  push: (level, msg, meta) =>
    set((s) => ({ entries: [{ id: ++seq, ts: Date.now(), level, msg, meta }, ...s.entries].slice(0, 200) })),
  clear: () => set({ entries: [] }),
}));

export const log = {
  info: (m: string, meta?: string) => useLog.getState().push('info', m, meta),
  ok: (m: string, meta?: string) => useLog.getState().push('success', m, meta),
  err: (m: string, meta?: string) => useLog.getState().push('error', m, meta),
  pending: (m: string, meta?: string) => useLog.getState().push('pending', m, meta),
};
