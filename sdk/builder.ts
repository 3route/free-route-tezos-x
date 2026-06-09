// Operation builders for the swap+bridge core: approve + call_evm(SwapBridge) + batch assembly.
// Pure — no chain I/O. Each builder returns a Taquito TransferParams; buildBatchTransaction tags them for a group.
// fee/gasLimit/storageLimit are PINNED from DEFAULTS (not estimated): on Tezos X previewnet Taquito's auto-fee
// undershoots the node's floor (insufficient_fees) AND a `call_evm` op needs an explicit gasLimit to provision
// the cross-runtime EVM execution budget (estimation only covers the ~17k Michelson wrapper → the EVM swap fails
// with a 400 cross-runtime error). Empirically confirmed on previewnet. Override per-op via the params.
import { OpKind } from '@taquito/taquito';
import type { TransferParams, ParamsWithKind } from '@taquito/taquito';
import type { MichelsonV1Expression } from '@taquito/rpc';
import { PREVIEWNET, DEFAULTS } from './config.js';
import { encodeApproveArgs, encodeSwapAndBridgePullArgs, SIG_APPROVE, SIG_SWAP_BRIDGE } from './translation.js';
import type { NetworkConfig, Quote, Tz1Address, Hex, EvmAddress } from './types.js';

// Micheline param for the Michelson->EVM gateway: %call_evm(dest, sig, abiargs, callback=None).
const callEvmParam = (dest: string, sig: string, abiargs: Hex): { entrypoint: string; value: MichelsonV1Expression } => ({
  entrypoint: 'call_evm',
  value: { prim: 'Pair', args: [{ string: dest }, { string: sig }, { bytes: abiargs.replace(/^0x/, '') }, { prim: 'None' }] },
});

// Scoped ERC20 approve (`token`.approve(SwapBridge, amountIn)) — runs AS the caller's alias via the gateway.
// SwapBridge revokes the allowance after the swap, so no standing approval and no post-op reset is needed.
export function buildApproveOperation(params: { cfg?: NetworkConfig; token: EvmAddress; amountIn: bigint; gasLimit?: number; fee?: number }): TransferParams {
  const cfg = params.cfg ?? PREVIEWNET;
  return {
    to: cfg.gatewayTez,
    amount: 0,
    parameter: callEvmParam(params.token, SIG_APPROVE, encodeApproveArgs(cfg.swapBridge, params.amountIn)),
    gasLimit: params.gasLimit ?? DEFAULTS.callEvmGas,
    storageLimit: DEFAULTS.storageLimit,
    fee: params.fee ?? DEFAULTS.fee,
  };
}

// The swap+bridge op: swap tokenIn->XTZ on EVM via the router, then auto-forward the XTZ to `recipientTz1` on Michelson.
export function buildSwapOperation(
  quote: Quote,
  params: { cfg?: NetworkConfig; recipientTz1: Tz1Address; gasLimit?: number; fee?: number },
): TransferParams {
  const cfg = params.cfg ?? PREVIEWNET;
  const abiargs = encodeSwapAndBridgePullArgs({ ...quote, recipientTz1: params.recipientTz1 });
  return {
    to: cfg.gatewayTez,
    amount: 0,
    parameter: callEvmParam(cfg.swapBridge, SIG_SWAP_BRIDGE, abiargs),
    gasLimit: params.gasLimit ?? DEFAULTS.callEvmGas,
    storageLimit: DEFAULTS.storageLimit,
    fee: params.fee ?? DEFAULTS.fee,
  };
}

// Tag operations as a batch group and guard the per-block gas cap (Σ gasLimit <= 3M on Tezos X).
// Universal: pass the swap+bridge ops plus any of your own operations (e.g. a marketplace fulfill).
export function buildBatchTransaction(
  operations: ReadonlyArray<TransferParams | null | undefined>,
  params?: { cfg?: NetworkConfig },
): ParamsWithKind[] {
  const cfg = params?.cfg ?? PREVIEWNET;
  const ops = operations.filter((op): op is TransferParams => Boolean(op));
  if (ops.length === 0) throw new Error('buildBatchTransaction: no operations');
  const totalGas = ops.reduce((sum, op) => sum + (op.gasLimit ?? 0), 0);
  if (totalGas > cfg.maxOpGas) throw new Error(`Σ gasLimit ${totalGas} > per-block cap ${cfg.maxOpGas}: lower limits or split the group`);
  return ops.map((op) => ({ kind: OpKind.TRANSACTION, ...op }));
}
