// scripts/env.ts — load .env into process.env (Node's built-in parser: strips quotes/comments/CRLF;
// already-set shell/CLI vars win) and expose typed access. Kept here (not in src/) so the SDK stays
// free of Node-only process access. Loads on import, so it works however the script is launched.
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // tolerant: .env may be absent — vars can come from the shell / CLI instead
}

export const env = process.env;

export const need = (k: string): string => {
  const v = env[k];
  if (!v) throw new Error(`missing ${k} — set it in .env, or pass it inline: ${k}=<value> <command>`);
  return v;
};
