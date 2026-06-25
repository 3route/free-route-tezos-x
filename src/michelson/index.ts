// Michelson-only entrypoint — core + the Michelson side. Pulls @taquito/taquito (NOT @taquito/michel-codec).
export * from '../core/index.js';

// ── Michelson side ──
export * from './call-evm-limits.js';
export * from './operations/index.js';
export * as objkt from '../objkt/michelson.js';
export * from './facade.js';
