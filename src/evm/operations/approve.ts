import { encodeCall } from '../../core/evm.js';
import type { EvmAddress, EvmTxRequest } from '../../core/primitives.js';

const SIG_APPROVE = 'approve(address,uint256)';

export interface BuildEvmApproveTransactionOptions {
  token: EvmAddress;
  spender: EvmAddress;
  amount: bigint;
}

/** ERC20 `approve(spender, amount)` as a native EVM tx (signed by the EVM account itself, no gateway). */
export const buildEvmApproveTransaction = (o: BuildEvmApproveTransactionOptions): EvmTxRequest => ({
  to: o.token,
  data: encodeCall(SIG_APPROVE, [o.spender, o.amount]),
  value: 0n,
});
