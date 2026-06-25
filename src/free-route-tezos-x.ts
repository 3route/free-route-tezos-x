import { FreeRouteCore } from './core/facade.js';
import { createMichelsonOps } from './michelson/facade.js';
import type { MichelsonOps } from './michelson/facade.js';
import { createEvmOps } from './evm/facade.js';
import type { EvmOps } from './evm/facade.js';

/**
 * Full Tezos X facade: free-route reads + both sides. `michelson.*` returns Taquito ops, `evm.*` returns EVM tx requests.
 */
export class FreeRouteTezosX extends FreeRouteCore {
  readonly michelson: MichelsonOps = createMichelsonOps(this);
  readonly evm: EvmOps = createEvmOps(this);
}
