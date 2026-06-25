// Root entrypoint — core + both sides + all three facades. Pulls @taquito/taquito and @taquito/michel-codec.
// For a single side only (lighter deps), import from '@baking-bad/free-route-tezos-x/michelson' or '/evm'.
export * from './core/index.js';

// ── Michelson side ──
export * from './michelson/call-evm-limits.js';
export * from './michelson/operations/index.js';
export * from './michelson/facade.js';

// ── EVM side ──
export * from './evm/operations/index.js';
export * from './evm/forge.js'; // forgeMichelson — forge a Micheline value for callMichelson data
export * from './evm/facade.js';

// ── combined ──
export * as objkt from './objkt/all.js';
export * from './free-route-tezos-x.js';
