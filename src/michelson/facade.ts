import type { ParamsWithKind } from '@taquito/taquito';
import { buildMichelsonSwapOperation, buildMichelsonApproveOperation, buildCallEvmOperation } from './operations/index.js';
import type { BuildMichelsonSwapOperationOptions, BuildMichelsonApproveOperationOptions, BuildCallEvmOperationOptions } from './operations/index.js';
import { estimateMichelsonOperation } from './estimate.js';
import type { EstimateMichelsonOperationOptions } from './estimate.js';
import { FreeRouteCore } from '../core/facade.js';
import type { MichelsonAddress } from '../core/primitives.js';

// Michelson-native builders (sign with Taquito), with michelsonGateway injected.
export interface MichelsonOpsBuilder {
  buildSwapOperation(o: Omit<BuildMichelsonSwapOperationOptions, 'michelsonGateway'>): ParamsWithKind[];
  buildApproveOperation(o: Omit<BuildMichelsonApproveOperationOptions, 'michelsonGateway'>): ParamsWithKind;
  buildCallEvmOperation(o: Omit<BuildCallEvmOperationOptions, 'michelsonGateway'>): ParamsWithKind;
  /** Simulate an op-group and size its call_evm ops (node estimate × margin) — see `estimateMichelsonOperation`. */
  estimateOperation(o: EstimateMichelsonOperationOptions): Promise<ParamsWithKind[]>;
}

export const createMichelsonOpsBuilder = (michelsonGateway: MichelsonAddress): MichelsonOpsBuilder => ({
  buildSwapOperation: (o) => buildMichelsonSwapOperation({ ...o, michelsonGateway }),
  buildApproveOperation: (o) => buildMichelsonApproveOperation({ ...o, michelsonGateway }),
  buildCallEvmOperation: (o) => buildCallEvmOperation({ ...o, michelsonGateway }),
  estimateOperation: estimateMichelsonOperation,
});

/**
 * Michelson-only facade. Use the root `FreeRouteTezosX` to also get `evm.*`.
 */
export class FreeRouteTezosXMichelson extends FreeRouteCore {
  readonly michelson: MichelsonOpsBuilder = createMichelsonOpsBuilder(this.michelsonGateway);
}
