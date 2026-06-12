// Same-origin proxy to the rust-3route server. The browser calls /api/v6.1/{chain}/{tokens,swap}, this forwards
// to THREE_ROUTE_API server-side — no CORS. The HTTP Basic api key (if the server needs one) is injected here
// from a SERVER-ONLY env var (THREE_ROUTE_API_KEY, not NEXT_PUBLIC_*), so it never reaches the browser bundle.
import type { NextRequest } from 'next/server';
import { authHeaders } from '@sdk/index.js';

const THREE_ROUTE_API = process.env.THREE_ROUTE_API ?? 'http://127.0.0.1:3000';
const THREE_ROUTE_API_KEY = process.env.THREE_ROUTE_API_KEY; // 'YourApiKey' for a hosted server; omit for the keyless local dev server

export async function GET(req: NextRequest, { params }: { params: { chain: string; path: string[] } }) {
  const target = `${THREE_ROUTE_API}/api/v6.1/${params.chain}/${params.path.join('/')}${req.nextUrl.search}`;
  // same auth scheme as the SDK client (single source of truth) — the key is injected server-side only.
  const headers = { 'Content-Type': 'application/json', ...authHeaders(THREE_ROUTE_API_KEY) };
  try {
    const r = await fetch(target, { headers });
    const body = await r.text();
    return new Response(body, { status: r.status, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: `3route proxy failed: ${(e as Error).message}`, target }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
