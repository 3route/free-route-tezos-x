import { FreeRouteCore } from './core/facade.js';
import { createMichelsonOpsBuilder } from './michelson/facade.js';
import type { MichelsonOpsBuilder } from './michelson/facade.js';
import { createEvmOpsBuilder } from './evm/facade.js';
import type { EvmOpsBuilder } from './evm/facade.js';

/**
 * Full Tezos X facade: free-route reads + both sides. `michelson.*` returns Taquito ops, `evm.*` returns EVM tx requests.
 */
export class FreeRouteTezosX extends FreeRouteCore {
  readonly michelson: MichelsonOpsBuilder = createMichelsonOpsBuilder(this.michelsonGateway);
  readonly evm: EvmOpsBuilder = createEvmOpsBuilder(this.evmGateway);
}
