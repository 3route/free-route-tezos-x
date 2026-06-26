import { isXtz } from '../../core/units.js';
import { buildEvmApproveTransaction } from './approve.js';
import type { Swap } from '../../core/free-route/models.js';
import type { ApprovalMode } from '../../core/approval.js';
import type { EvmAddress, EvmTxRequest } from '../../core/primitives.js';

export interface BuildEvmSwapTransactionOptions {
  swap: Swap; // a free-route /swap response — its `tx` IS the native EVM swap transaction
  srcAddress: EvmAddress; // input token
  approval?: ApprovalMode; // default 'resetThenApprove'
}

/**
 * EVM-native swap (the Bridge for an EVM account): send the /swap response's `tx` directly. ERC20 input →
 * approve(s) + swap per {@link ApprovalMode}; native-XTZ input → the single swap tx carrying XTZ as value.
 * No gas/fees here — the wallet estimates them.
 */
export function buildEvmSwapTransaction(o: BuildEvmSwapTransactionOptions): EvmTxRequest[] {
  const swapTx: EvmTxRequest = { to: o.swap.tx.to, data: o.swap.tx.data, value: o.swap.tx.value };
  if (isXtz(o.srcAddress)) 
    return [swapTx]; // native XTZ carries msg.value, no approve
  
  const approval = o.approval ?? 'resetThenApprove';
  if (approval === 'none') 
    return [swapTx];
  
  const approve = buildEvmApproveTransaction({ token: o.srcAddress, spender: o.swap.tx.to, amount: o.swap.srcAmount });
  return approval === 'resetThenApprove'
    ? [buildEvmApproveTransaction({ token: o.srcAddress, spender: o.swap.tx.to, amount: 0n }), approve, swapTx]
    : [approve, swapTx];
}
