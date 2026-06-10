// helpers.ts — mirrors the gist's helpers (API client + in-batch approve wrapper). Plus a Michelson-address
// ->alias resolver and a call_evm builder (needed because on Tezos X the 3route router is an EVM contract).
//   KEPT 1:1 : the FreeRouteApi class shape (getTokens / getSwap / makeRequest); the approve-wrap pattern.
//   CHANGED  : Michelson FA12/FA2 approve -> EVM ERC20 approve via call_evm; getSwapForParams(hops) -> getSwap(1inch).
//   REMOVED  : mapHopToFreeRouteV4ContractHop (no Michelson hops).
//   ADDED    : tzToAlias, buildCallEvm (cross-VM glue), NATIVE_XTZ sentinel, SWAP_SIG.
import { OpKind } from '@taquito/taquito';
import type { ParamsWithKind, TransferParams } from '@taquito/taquito';
import { AbiCoder, getAddress, keccak256, toUtf8Bytes } from 'ethers';
import type { EvmAddress, Hex, MichelsonAddress, SwapResponse, ThreeRouteToken } from './types.js';

// 1inch native-token sentinel — pass as `dst` to receive native XTZ.
export const NATIVE_XTZ: EvmAddress = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
// 3route UniversalRouter swap signature (selector 0x2dbbf153) — call_evm needs the sig + (calldata minus selector).
export const SWAP_SIG = 'swap(uint256,uint256,address,uint256,uint256,(address[],uint256),(address,uint256)[],(address,uint256,uint256))';
const SIG_APPROVE = 'approve(address,uint256)';
const abi = AbiCoder.defaultAbiCoder();

// was FreeRouteApi (objkt.3route.io /v4/...); now Tezos X EVM 3route (1inch-v6.1 /api/v6.1/{chain}/...).
export class ThreeRouteApi {
  constructor(
    protected readonly apiBaseUrl: string,
    protected readonly chainId: number,
  ) {}

  async getTokens(): Promise<ThreeRouteToken[]> {
    const { tokens } = await this.makeRequest<{ tokens: Record<string, ThreeRouteToken> }>('tokens');
    return Object.values(tokens);
  }

  // exact-out: how much `src` to spend for `amount` (wei) of `dst`, with ready router calldata sending output to `receiver`.
  // (was getSwapForParams(symbolX, symbolY, output))
  async getSwap(src: EvmAddress, dst: EvmAddress, amount: string, from: EvmAddress, receiver: EvmAddress, slippage = 1): Promise<SwapResponse> {
    const q = new URLSearchParams({ src, dst, amount, from, receiver, slippage: String(slippage), isExactOutput: 'true' });
    return this.makeRequest<SwapResponse>(`swap?${q.toString()}`);
  }

  private async makeRequest<T>(path: string): Promise<T> {
    const response = await fetch(`${this.apiBaseUrl}/api/v6.1/${this.chainId}/${path}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.json() as Promise<T>;
  }
}

// Michelson address -> EVM alias (one-way). ADDED: the input ERC20 lives on the alias and the swap runs as it.
export const tzToAlias = (michelsonAddress: MichelsonAddress): EvmAddress => getAddress('0x' + keccak256(toUtf8Bytes(michelsonAddress)).slice(2, 42));

// Michelson->EVM gateway %call_evm(dest, sig, abiargs, callback=None) — wraps an EVM call as a Tezos op.
// Replaces the gist's `freeRouteContract.methodsObject.execute(...).toTransferParams()` (Michelson-native there).
// Limits are PINNED: on previewnet Taquito auto-fee undershoots the floor AND a call_evm needs an explicit gasLimit.
export const buildCallEvm = (gateway: string, dest: EvmAddress, sig: string, abiargs: Hex): TransferParams => ({
  to: gateway,
  amount: 0,
  parameter: { entrypoint: 'call_evm', value: { prim: 'Pair', args: [{ string: dest }, { string: sig }, { bytes: abiargs.replace(/^0x/, '') }, { prim: 'None' }] } },
  gasLimit: 500_000,
  storageLimit: 2_000,
  fee: 150_000,
});

interface WrapWithEvmApproveParameters {
  operationParams: readonly ParamsWithKind[];
  gateway: string;
  token: EvmAddress;
  spender: EvmAddress; // the 3route router
  amount: string;
  isNeedToReset?: boolean;
}

// was wrapOperationParamsWithFA12Approve / ...WithFA2Approve; now an EVM ERC20 approve via call_evm.
// Same in-batch pattern: prepend approve (and, if needed, an approve(0) reset for USDT-style tokens).
export const wrapOperationParamsWithEvmApprove = (options: WrapWithEvmApproveParameters): ParamsWithKind[] => {
  const approve = (value: string): ParamsWithKind => ({
    kind: OpKind.TRANSACTION,
    ...buildCallEvm(options.gateway, options.token, SIG_APPROVE, abi.encode(['address', 'uint256'], [options.spender, value])),
  });
  const reset = options.isNeedToReset ? [approve('0')] : [];
  return [...reset, approve(options.amount), ...options.operationParams];
};
