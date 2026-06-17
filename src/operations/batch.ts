import type { ParamsWithKind } from '@taquito/taquito';

/** Concatenate ops/op-groups into one ordered list to sign as a single batch (atomic when sent as one group),
 *  e.g. `buildBatchTransaction(swapOps, fulfillOp)`. */
export const buildBatchTransaction = (...operations: Array<ParamsWithKind | ParamsWithKind[]>): ParamsWithKind[] =>
  operations.flat();
