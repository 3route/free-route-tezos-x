// Same-origin proxy to the rust-3route server. The browser calls /api/v6.1/{chain}/{tokens,swap},
// this forwards to RS_API server-side — no CORS, no keys in the browser. Keyless GET only.
import type { NextRequest } from 'next/server';

const RS_API = process.env.RS_API ?? 'http://127.0.0.1:3000';

export async function GET(req: NextRequest, { params }: { params: { chain: string; path: string[] } }) {
  const target = `${RS_API}/api/v6.1/${params.chain}/${params.path.join('/')}${req.nextUrl.search}`;
  try {
    const r = await fetch(target, { headers: { 'Content-Type': 'application/json' } });
    const body = await r.text();
    return new Response(body, { status: r.status, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: `3route proxy failed: ${(e as Error).message}`, target }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
