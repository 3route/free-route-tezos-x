import { ParameterSchema } from '@taquito/michelson-encoder';
import type { MichelsonData } from '@taquito/michel-codec';
import type { Hex, MichelsonAddress, Nat, OpLimits } from '../core/primitives.js';

export interface FulfillAskOptions {
  marketplace: MichelsonAddress;
  askId: Nat;
  amountMutez: bigint | number; // total XTZ to send = ask unit price × editions
  editions: Nat; // copies to buy; maps to the contract's overloaded %amount
  recipient?: MichelsonAddress | null;
  conditionExtra?: Hex | null;
  referrers?: Record<MichelsonAddress, Nat>;
  limits?: OpLimits; // Michelson op only: pin to skip estimation; omit to let Taquito estimate
}

// objkt v4 fulfill_ask parameter — shared by the Michelson op (buildFulfillAsk) and the EVM callMichelson
// tx (buildEvmFulfillAsk). Uses michelson-encoder only; the MichelsonData type import is erased at runtime,
// so this file pulls neither @taquito/taquito nor @taquito/michel-codec.
export const FULFILL_ASK_TYPE = {
  prim: 'pair',
  args: [
    { prim: 'nat', annots: ['%ask_id'] },
    { prim: 'nat', annots: ['%amount'] },
    { prim: 'option', args: [{ prim: 'address' }], annots: ['%proxy_for'] },
    { prim: 'option', args: [{ prim: 'bytes' }], annots: ['%condition_extra'] },
    { prim: 'map', args: [{ prim: 'address' }, { prim: 'nat' }], annots: ['%referrers'] },
  ],
};
const schema = new ParameterSchema(FULFILL_ASK_TYPE);

export const fulfillAskValue = (p: FulfillAskOptions): MichelsonData =>
  schema.EncodeObject({
    ask_id: p.askId,
    amount: p.editions,
    proxy_for: p.recipient ?? null,
    condition_extra: p.conditionExtra ?? null,
    referrers: p.referrers ?? {},
  }) as MichelsonData;
