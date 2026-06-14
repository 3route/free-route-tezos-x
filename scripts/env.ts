// scripts/env.ts — load .env once and merge process.env on top (CLI overrides win). Zero-dep.
// Kept here (not in src/) so the SDK stays free of Node-only fs/process access.
import { readFileSync } from 'node:fs';

function readEnvFile(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  let text: string;
  try { text = readFileSync(url, 'utf8'); } catch { return out; } // tolerant: file may be absent
  for (const line of text.split('\n')) {
    const e = line.match(/^([A-Z0-9_]+)=(.*)$/); // no inline comments after '=' — value is the rest of the line
    if (e) out[e[1] as string] = e[2] as string;
  }
  return out;
}

const fileEnv = readEnvFile(new URL('../.env', import.meta.url));
export const env: Record<string, string | undefined> = { ...fileEnv, ...process.env };

export const need = (k: string): string => {
  const v = env[k];
  if (!v) throw new Error(`missing ${k} — set it in .env or pass it on the CLI`);
  return v;
};
