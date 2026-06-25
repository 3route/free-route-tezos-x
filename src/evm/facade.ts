import { buildEvmSwap, buildEvmApprove, buildCallMichelson } from './operations/index.js';
import type { BuildEvmSwapOptions, BuildEvmApproveOptions, BuildCallMichelsonOptions } from './operations/index.js';
import { FreeRouteCore } from '../core/facade.js';
import type { EvmAddress, EvmTxRequest } from '../core/primitives.js';

// EVM-native builders (sign with the EVM wallet), with evmGateway injected.
export interface EvmOps {
  buildSwap(o: BuildEvmSwapOptions): EvmTxRequest[];
  buildApprove(o: BuildEvmApproveOptions): EvmTxRequest;
  buildCallMichelson(o: Omit<BuildCallMichelsonOptions, 'evmGateway'>): EvmTxRequest;
}

export const createEvmOps = (g: { evmGateway: EvmAddress }): EvmOps => ({
  buildSwap: (o) => buildEvmSwap(o),
  buildApprove: (o) => buildEvmApprove(o),
  buildCallMichelson: (o) => buildCallMichelson({ ...o, evmGateway: g.evmGateway }),
});

/**
 * EVM-only facade (sign with an EVM wallet, e.g. MetaMask): free-route reads + `evm.*` builders.
 * Pulls @taquito/michel-codec but not @taquito/taquito. Use the root `FreeRouteTezosX` to also get `michelson.*`.
 */
export class FreeRouteTezosXEvm extends FreeRouteCore {
  readonly evm: EvmOps = createEvmOps(this);
}
