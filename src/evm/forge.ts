import { packDataBytes } from '@taquito/michel-codec';
import type { MichelsonData, MichelsonType } from '@taquito/michel-codec';
import type { Hex } from '../core/primitives.js';

/**
 * Forge a Michelson value to its binary form for the gateway's `callMichelson(data)` — the forged
 * Micheline WITHOUT the 0x05 PACK tag. (packDataBytes returns `05` ++ forged; the gateway wants only the
 * forged part. Passing the type optimizes addresses/ints to their packed byte form, which the runtime expects.)
 */
export const forgeMichelson = (value: MichelsonData, type: MichelsonType): Hex =>
  ('0x' + packDataBytes(value, type).bytes.slice(2)) as Hex;
