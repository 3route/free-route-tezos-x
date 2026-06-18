import type { ParamsWithKind } from '@taquito/taquito';
import { buildCallEvm } from './call-evm.js';
import { buildErc20Approve } from './approve.js';
import { callEvmGas } from '../call-evm-limits.js';
import type { CallEvmLimits } from '../call-evm-limits.js';
import { isXtz, xtzWeiToMutez } from '../units.js';
import type { Swap } from '../threeroute/models.js';
import type { ApprovalMode } from '../approval.js';
import type { EvmAddress, Hex, MichelsonAddress } from '../primitives.js';

// 3route UniversalRouter swap signature (selector 0x2dbbf153)
const SWAP_SIG =
  'swap(uint256,uint256,address,uint256,uint256,(address[],uint256),(address,uint256)[],(address,uint256,uint256))';

export interface BuildSwapOperationOptions {
  swap: Swap; // a 3route /swap response
  gateway: MichelsonAddress; // Michelson→EVM gateway (call_evm)
  srcAddress: EvmAddress; // input token
  approval?: ApprovalMode; // default 'resetThenApprove'
  limits?: CallEvmLimits; // override the swap op's limits
}

/**
 * Turn a 3route /swap response into ready-to-sign Tezos ops, no network. ERC20 input → approve(s) + swap per
 * {@link ApprovalMode}; native-XTZ input → a single swap op carrying the XTZ as msg.value.
 */
export function buildSwapOperation(opts: BuildSwapOperationOptions): ParamsWithKind[] {
  const native = isXtz(opts.srcAddress);
  const swap = opts.swap;
  const swapOp = buildCallEvm({
    gateway: opts.gateway,
    dest: swap.tx.to,
    sig: SWAP_SIG,
    abiargs: swap.tx.data.slice(10) as Hex, // strip 0x + 4-byte selector — call_evm gets the args only
    valueMutez: native ? xtzWeiToMutez(swap.tx.value) : 0n,
    limits: opts.limits ?? callEvmGas.fromEvmEstimate(swap.tx.gas),
  });
  const approval = opts.approval ?? 'resetThenApprove';
  if (native || approval === 'none') 
    return [swapOp]; // native XTZ needs no approve; 'none' = caller manages it
  
  const approve = buildErc20Approve({ gateway: opts.gateway, token: opts.srcAddress, spender: swap.tx.to, amount: swap.srcAmount });
  return approval === 'resetThenApprove'
    ? [buildErc20Approve({ gateway: opts.gateway, token: opts.srcAddress, spender: swap.tx.to, amount: 0n }), approve, swapOp]
    : [approve, swapOp];
}
