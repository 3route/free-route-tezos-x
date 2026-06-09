// High-level SDK entry: assemble the swap+bridge operations for a quote.
// Produces [reset?, approve?, swapAndBridgePull] — i.e. "pull an ERC20 from the buyer's EVM alias, swap it to
// native XTZ via the router, bridge that XTZ to the buyer tz1". The consumer appends its own operation(s) and
// runs them through buildBatchTransaction to form one atomic op-group.
import { ethers } from 'ethers';
import type { TransferParams } from '@taquito/taquito';
import { PREVIEWNET } from './config.js';
import { tzToAlias } from './translation.js';
import { buildSwapOperation, buildApproveOperation } from './builder.js';
import type { NetworkConfig, Quote, Tz1Address, SwapBridgeBatch, EvmAddress } from './types.js';

// Prepend a scoped approve to the op list (in-batch authorization). Pure.
// `resetFirst` also prepends an approve(0): some ERC20s (USDT-style) revert approve(non-zero) over a non-zero allowance.
export function wrapWithApprove(
  operations: TransferParams[],
  params: { cfg?: NetworkConfig; token: EvmAddress; amountIn: bigint; resetFirst?: boolean },
): TransferParams[] {
  const reset = params.resetFirst ? [buildApproveOperation({ cfg: params.cfg, token: params.token, amountIn: 0n })] : [];
  return [...reset, buildApproveOperation({ cfg: params.cfg, token: params.token, amountIn: params.amountIn }), ...operations];
}

const ERC20_ALLOWANCE_ABI = ['function allowance(address,address) view returns(uint256)'];
interface AllowanceReader {
  allowance(owner: string, spender: string): Promise<bigint>;
}

// quote + buyer -> the swap+bridge ops (untagged). Reads the alias's allowance for the pay token and prepends
// a scoped approve (and a USDT-style reset) only if it is short. Combine `ops` with your own operation(s) and
// pass the result to buildBatchTransaction.
export async function buildSwapBridgeBatch(params: {
  cfg?: NetworkConfig;
  provider: ethers.Provider;
  buyerTz1: Tz1Address;
  quote: Quote;
  resetAllowance?: boolean; // override the auto reset-before-approve (default: reset iff allowance is non-zero)
}): Promise<SwapBridgeBatch> {
  const cfg = params.cfg ?? PREVIEWNET;
  const alias = tzToAlias(params.buyerTz1);
  const payToken: EvmAddress = params.quote.tokenIn;
  const erc20 = new ethers.Contract(payToken, ERC20_ALLOWANCE_ABI, params.provider) as unknown as AllowanceReader;
  const allowance = await erc20.allowance(alias, cfg.swapBridge);

  const approvePrepended = allowance < params.quote.amountIn;
  // USDT-style guard: if we approve over a non-zero allowance, reset it to 0 first. Auto unless overridden.
  const resetPrepended = approvePrepended && (params.resetAllowance ?? allowance > 0n);

  const swapOp = buildSwapOperation(params.quote, { cfg, recipientTz1: params.buyerTz1 });
  const ops = approvePrepended
    ? wrapWithApprove([swapOp], { cfg, token: payToken, amountIn: params.quote.amountIn, resetFirst: resetPrepended })
    : [swapOp];

  return { ops, alias, allowance, approvePrepended, resetPrepended };
}
