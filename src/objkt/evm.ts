import type { MichelsonType } from '@taquito/michel-codec';
import { buildCallMichelson } from '../evm/operations/call-michelson.js';
import { forgeMichelson } from '../evm/forge.js';
import { EVM_GATEWAY } from '../core/networks.js';
import { fulfillAskValue, FULFILL_ASK_TYPE } from './ask.js';
import type { FulfillAskOptions } from './ask.js';
import type { EvmAddress, EvmTxRequest } from '../core/primitives.js';

export type { FulfillAskOptions } from './ask.js';

/** objkt v4 `fulfill_ask` from the EVM side: a callMichelson tx whose msg.value funds the buy (the NFT lands
 *  on the EVM account's Michelson alias). Mirror of `buildFulfillAsk` for native EVM accounts. */
export const buildEvmFulfillAsk = (p: Omit<FulfillAskOptions, 'limits'> & { evmGateway?: EvmAddress }): EvmTxRequest =>
  buildCallMichelson({
    destination: p.marketplace,
    entrypoint: 'fulfill_ask',
    data: forgeMichelson(fulfillAskValue(p), FULFILL_ASK_TYPE as MichelsonType),
    valueMutez: BigInt(p.amountMutez),
    evmGateway: p.evmGateway ?? EVM_GATEWAY,
  });
