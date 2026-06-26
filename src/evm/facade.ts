import { buildEvmSwapTransaction, buildEvmApproveTransaction, buildCallMichelsonTransaction } from './operations/index.js';
import type { BuildEvmSwapTransactionOptions, BuildEvmApproveTransactionOptions, BuildCallMichelsonTransactionOptions } from './operations/index.js';
import { FreeRouteCore } from '../core/facade.js';
import type { EvmAddress, EvmTxRequest } from '../core/primitives.js';

// EVM-native builders (sign with the EVM wallet), with evmGateway injected.
export interface EvmOpsBuilder {
  buildSwapTransaction(o: BuildEvmSwapTransactionOptions): EvmTxRequest[];
  buildApproveTransaction(o: BuildEvmApproveTransactionOptions): EvmTxRequest;
  buildCallMichelsonTransaction(o: Omit<BuildCallMichelsonTransactionOptions, 'evmGateway'>): EvmTxRequest;
}

export const createEvmOpsBuilder = (evmGateway: EvmAddress): EvmOpsBuilder => ({
  buildSwapTransaction: (o) => buildEvmSwapTransaction(o),
  buildApproveTransaction: (o) => buildEvmApproveTransaction(o),
  buildCallMichelsonTransaction: (o) => buildCallMichelsonTransaction({ ...o, evmGateway }),
});

/**
 * EVM-only facade (sign with an EVM wallet, e.g. MetaMask): free-route reads + `evm.*` builders.
 * Pulls @taquito/michel-codec but not @taquito/taquito. Use the root `FreeRouteTezosX` to also get `michelson.*`.
 */
export class FreeRouteTezosXEvm extends FreeRouteCore {
  readonly evm: EvmOpsBuilder = createEvmOpsBuilder(this.evmGateway);
}
