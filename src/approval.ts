import { Interface } from 'ethers';
import type { EvmAddress } from './primitives.js';
import { requestJson, type FetchLike } from './http.js';

/** ERC20 allowance handling: `resetThenApprove` (approve(0) then amount — safest, covers USDT), `approve`, or `none`. */
export type ApprovalMode = 'resetThenApprove' | 'approve' | 'none';

/** Pick the minimal safe ApprovalMode for a known allowance vs the required amount. */
export function selectApproval(currentAllowance: bigint, requiredAmount: bigint): ApprovalMode {
  if (currentAllowance >= requiredAmount) return 'none';
  if (currentAllowance === 0n) return 'approve';
  return 'resetThenApprove';
}

const erc20 = new Interface(['function allowance(address,address) view returns (uint256)']);

export interface AllowanceQuery {
  evmRpc: string;
  token: EvmAddress;
  owner: EvmAddress;
  spender: EvmAddress;
  timeoutMs?: number; // eth_call abort timeout (default 10s)
  fetch?: FetchLike; // default globalThis.fetch
}

/** Read allowance(owner → spender) for an ERC20 via eth_call. */
export async function readAllowance(params: AllowanceQuery): Promise<bigint> {
  const data = erc20.encodeFunctionData('allowance', [params.owner, params.spender]);
  const res = await requestJson<{ result?: string; error?: { message?: string } }>(params.evmRpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: params.token, data }, 'latest'] }),
    timeoutMs: params.timeoutMs,
    fetch: params.fetch,
  });
  if (res.error || res.result === undefined) throw new Error(`eth_call allowance -> ${res.error?.message ?? 'no result'}`);
  // non-ERC20 `token` returns empty data ('0x'); decodeFunctionResult would throw cryptically.
  if (res.result === '0x') throw new Error(`eth_call allowance -> empty result (is ${params.token} an ERC20?)`);
  return erc20.decodeFunctionResult('allowance', res.result)[0] as bigint;
}

/** Read the on-chain allowance and pick the ApprovalMode in one call. */
export async function resolveApproval(params: AllowanceQuery & { amount: bigint }): Promise<ApprovalMode> {
  const allowance = await readAllowance(params);
  return selectApproval(allowance, params.amount);
}
