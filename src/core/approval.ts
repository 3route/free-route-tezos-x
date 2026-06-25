import type { EvmAddress } from './primitives.js';
import { requestJson, type FetchLike } from './http.js';
import { encodeCall, decodeUint256 } from './evm.js';

/** ERC20 allowance handling: `resetThenApprove` (approve(0) then amount — safest, covers USDT), `approve`, or `none`. */
export type ApprovalMode = 'resetThenApprove' | 'approve' | 'none';

/** Pick the minimal safe ApprovalMode for a known allowance vs the required amount. */
export function selectApproval(currentAllowance: bigint, requiredAmount: bigint): ApprovalMode {
  if (currentAllowance >= requiredAmount) return 'none';
  if (currentAllowance === 0n) return 'approve';
  return 'resetThenApprove';
}

interface Erc20ReadBase {
  evmRpc: string;
  token: EvmAddress;
  timeoutMs?: number; // eth_call abort timeout (default 10s)
  fetch?: FetchLike; // default globalThis.fetch
}

// eth_call (latest) returning the raw result hex; throws on RPC error or missing result.
async function ethCall(to: EvmAddress, data: string, o: Erc20ReadBase): Promise<string> {
  const res = await requestJson<{ result?: string; error?: { message?: string } }>(o.evmRpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
    timeoutMs: o.timeoutMs,
    fetch: o.fetch,
  });
  if (res.error || res.result === undefined) throw new Error(`eth_call -> ${res.error?.message ?? 'no result'}`);
  return res.result;
}

// a uint256-returning ERC20 view; '0x' (empty) means `token` isn't that ERC20.
async function readErc20Uint(fn: string, args: readonly EvmAddress[], o: Erc20ReadBase): Promise<bigint> {
  const result = await ethCall(o.token, encodeCall(fn, args), o);
  if (result === '0x') throw new Error(`${fn} -> empty result (is ${o.token} an ERC20?)`);
  return decodeUint256(result);
}

export interface AllowanceQuery extends Erc20ReadBase {
  owner: EvmAddress;
  spender: EvmAddress;
}

/** Read allowance(owner → spender) for an ERC20 via eth_call. */
export function readAllowance(q: AllowanceQuery): Promise<bigint> {
  return readErc20Uint('allowance(address,address)', [q.owner, q.spender], q);
}

export interface Erc20BalanceQuery extends Erc20ReadBase {
  owner: EvmAddress;
}

/** Read balanceOf(owner) for an ERC20 via eth_call. */
export function readErc20Balance(q: Erc20BalanceQuery): Promise<bigint> {
  return readErc20Uint('balanceOf(address)', [q.owner], q);
}

/** Read the on-chain allowance and pick the ApprovalMode in one call. */
export async function resolveApproval(params: AllowanceQuery & { amount: bigint }): Promise<ApprovalMode> {
  const allowance = await readAllowance(params);
  return selectApproval(allowance, params.amount);
}
