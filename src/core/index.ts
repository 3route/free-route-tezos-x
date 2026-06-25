// Core public surface — shared by every entrypoint. Depends only on @noble/hashes + @taquito/utils
// (no @taquito/taquito, no @taquito/michel-codec), so it is safe to load from either side.
export * from './primitives.js';
export type { FetchLike } from './http.js'; // injectable-fetch type used in client/options (requestJson stays internal)
export * from './units.js';
export * from './address.js';
export * from './free-route/index.js';
export * from './slippage.js';
export * from './approval.js';
export * from './networks.js';
export * from './facade.js';
