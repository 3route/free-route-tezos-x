// EVM-only entrypoint — core + the EVM side. Pulls @taquito/michel-codec (NOT @taquito/taquito).
export * from '../core/index.js';

// ── EVM side ──
export * from './operations/index.js';
export * from './forge.js'; // forgeMichelson — forge a Micheline value for callMichelson data
export * as objkt from '../objkt/evm.js';
export * from './facade.js';
