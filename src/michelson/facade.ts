import type { ParamsWithKind } from '@taquito/taquito';
import { buildSwapOperation, buildErc20Approve, buildCallEvm } from './operations/index.js';
import type { BuildSwapOperationOptions, BuildErc20ApproveOptions, BuildCallEvmOptions } from './operations/index.js';
import { FreeRouteCore } from '../core/facade.js';
import type { MichelsonAddress } from '../core/primitives.js';

// Michelson-native builders (sign with Taquito), with michelsonGateway injected.
export interface MichelsonOps {
  buildSwapOperation(o: Omit<BuildSwapOperationOptions, 'michelsonGateway'>): ParamsWithKind[];
  buildErc20Approve(o: Omit<BuildErc20ApproveOptions, 'michelsonGateway'>): ParamsWithKind;
  buildCallEvm(o: Omit<BuildCallEvmOptions, 'michelsonGateway'>): ParamsWithKind;
}

export const createMichelsonOps = (g: { michelsonGateway: MichelsonAddress }): MichelsonOps => ({
  buildSwapOperation: (o) => buildSwapOperation({ ...o, michelsonGateway: g.michelsonGateway }),
  buildErc20Approve: (o) => buildErc20Approve({ ...o, michelsonGateway: g.michelsonGateway }),
  buildCallEvm: (o) => buildCallEvm({ ...o, michelsonGateway: g.michelsonGateway }),
});

/**
 * Michelson-only facade. Use the root `FreeRouteTezosX` to also get `evm.*`.
 */
export class FreeRouteTezosXMichelson extends FreeRouteCore {
  readonly michelson: MichelsonOps = createMichelsonOps(this);
}
