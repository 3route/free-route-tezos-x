import { OpKind } from '@taquito/taquito';
import type { ParamsWithKind } from '@taquito/taquito';
import { ParameterSchema } from '@taquito/michelson-encoder';
import type { Hex, MichelsonAddress, Nat } from './primitives.js';

export interface FulfillAskOptions {
  marketplace: MichelsonAddress;
  askId: Nat;
  amountMutez: bigint | number; // total XTZ to send = ask unit price × editions (the op value)
  editions: Nat; // copies to buy; maps to the contract's overloaded %amount
  recipient?: MichelsonAddress | null;
  conditionExtra?: Hex | null; 
  referrers?: Record<MichelsonAddress, Nat>;
}

const fulfillAsk = new ParameterSchema({
  prim: 'pair',
  args: [
    { prim: 'nat', annots: ['%ask_id'] },
    { prim: 'nat', annots: ['%amount'] },
    { prim: 'option', args: [{ prim: 'address' }], annots: ['%proxy_for'] },
    { prim: 'option', args: [{ prim: 'bytes' }], annots: ['%condition_extra'] },
    { prim: 'map', args: [{ prim: 'address' }, { prim: 'nat' }], annots: ['%referrers'] },
  ],
});

/** objkt v4 `fulfill_ask` op (buy a listed ask), the amountMutez is the op value. */
export const buildFulfillAsk = (p: FulfillAskOptions): ParamsWithKind => {
  return {
    kind: OpKind.TRANSACTION,
    to: p.marketplace,
    amount: Number(p.amountMutez),
    mutez: true,
    parameter: {
      entrypoint: 'fulfill_ask',
      value: fulfillAsk.EncodeObject({
        ask_id: p.askId,
        amount: p.editions,
        proxy_for: p.recipient ?? null,
        condition_extra: p.conditionExtra ?? null,
        referrers: p.referrers ?? {},
      }),
    },
  };
};
