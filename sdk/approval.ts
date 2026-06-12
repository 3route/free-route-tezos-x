// approval.ts — ERC20 allowance handling for swaps: the mode enum + three building blocks that separate IO from
// the decision. `readAllowance` is the only IO (a plain JSON-RPC eth_call — the 3route client is NOT an EVM RPC,
// so it takes a separate `evmRpc`); `selectApproval` is pure (you pass the allowance); `resolveApproval` is the
// convenience that composes the two. Read allowance once and you can both display it and pick the mode.
import { AbiCoder } from 'ethers';
import type { EvmAddress } from './address.js';

// How to handle the ERC20 allowance before a swap pulls the input:
//   resetThenApprove — approve(0) then approve(amount): safest (covers USDT-style require(allowance==0) and the
//                      approve-race); the default in buildSwapOperation. · approve — just approve(amount).
//   none — no approve (caller already has a sufficient allowance, or the input is native XTZ).
export type ApprovalMode = 'resetThenApprove' | 'approve' | 'none';

// Pure decision: pick the safe & minimal mode from a known allowance and the amount the swap will pull.
//   allowance ≥ required → none (skip) · allowance == 0 → approve · 0 < allowance < required → resetThenApprove.
export function selectApproval(currentAllowance: bigint, requiredAmount: bigint): ApprovalMode {
  if (currentAllowance >= requiredAmount) return 'none';
  if (currentAllowance === 0n) return 'approve';
  return 'resetThenApprove';
}

const abi = AbiCoder.defaultAbiCoder();
const ALLOWANCE_SELECTOR = '0xdd62ed3e'; // allowance(address,address)

// Read allowance(owner -> spender) for `token` via a plain JSON-RPC eth_call (no ethers Provider). `spender` is
// the 3route router (the swap's tx.to / SwapDetails.router); `owner` is the EVM alias. Read at 'latest'.
export async function readAllowance(params: {
  evmRpc: string;
  token: EvmAddress;
  owner: EvmAddress;
  spender: EvmAddress;
  timeoutMs?: number; // abort the eth_call after this long (default 10s) — don't hang on a dead RPC
}): Promise<bigint> {
  const data = ALLOWANCE_SELECTOR + abi.encode(['address', 'address'], [params.owner, params.spender]).slice(2);
  const http = await fetch(params.evmRpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: params.token, data }, 'latest'] }),
    signal: AbortSignal.timeout(params.timeoutMs ?? 10_000),
  });
  if (!http.ok) throw new Error(`eth_call allowance -> HTTP ${http.status}`); // fetch doesn't throw on 4xx/5xx
  const res = (await http.json()) as { result?: string; error?: { message?: string } };
  if (res.error || res.result === undefined) throw new Error(`eth_call allowance -> ${res.error?.message ?? 'no result'}`);
  // a contract-less / non-ERC20 `token` makes the call return empty data ('0x'); BigInt('0x') would throw cryptically.
  if (res.result === '0x') throw new Error(`eth_call allowance -> empty result (is ${params.token} an ERC20?)`);
  return BigInt(res.result);
}

// Convenience: read the on-chain allowance and pick the mode in one call. The allowance is read at 'latest', so
// building the ops from it is a TOCTOU read — but the alias allowance is only touched by its owner and the
// default resetThenApprove is the safety net, so a stale read can't make a swap unsafe.
export async function resolveApproval(params: {
  evmRpc: string;
  token: EvmAddress;
  owner: EvmAddress;
  spender: EvmAddress;
  amount: bigint;
  timeoutMs?: number;
}): Promise<ApprovalMode> {
  const allowance = await readAllowance(params);
  return selectApproval(allowance, params.amount);
}
