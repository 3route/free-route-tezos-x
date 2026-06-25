import { OpKind } from '@taquito/taquito';
import type { ParamsWithKind } from '@taquito/taquito';
import { fulfillAskValue } from './ask.js';
import type { FulfillAskOptions } from './ask.js';

export type { FulfillAskOptions } from './ask.js';

/** objkt v4 `fulfill_ask` Michelson op (buy a listed ask); amountMutez is the op value. */
export const buildFulfillAsk = (p: FulfillAskOptions): ParamsWithKind => ({
  kind: OpKind.TRANSACTION,
  to: p.marketplace,
  amount: Number(p.amountMutez),
  mutez: true,
  parameter: { entrypoint: 'fulfill_ask', value: fulfillAskValue(p) },
  ...(p.limits ?? {}),
});
