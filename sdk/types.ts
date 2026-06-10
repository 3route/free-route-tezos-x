// types.ts — mirrors the L1 gist's types, adapted for Tezos X (EVM-side 3route + tz1 alias).
//   KEPT 1:1 : ObjktContract / ObjktContractFulfillAskParams (objkt v4 fulfill_ask — same ABI).
//   CHANGED  : FreeRouteV4Contract (Michelson execute) -> EVM router via call_evm (no Michelson contract);
//              TezosToken (fa12/fa2/xtz union) -> EVM ERC20 token; SwapParams {input,output,hops} -> 1inch /swap response.
//   REMOVED  : FA12Contract / FA2Contract / FreeRouteV4ContractHop (Michelson-only).
import type { ContractAbstraction, ContractMethodObject, ContractProvider, Wallet, MichelsonMap } from '@taquito/taquito';

export type Tz1Address = string;
export type EvmAddress = string;
export type Hex = string;

// --- objkt v4 — KEPT 1:1 from the gist ---
export interface ObjktContractFulfillAskParams {
  ask_id: string;
  amount: string;
  proxy_for: string | null;
  condition_extra: string | null;
  referrers: MichelsonMap<string, string>;
}
export type ObjktContract<T extends ContractProvider | Wallet = ContractProvider> = ContractAbstraction<T> & {
  methodsObject: {
    fulfill_ask(params: ObjktContractFulfillAskParams): ContractMethodObject<T>;
  };
};

// --- token — was the gist's TezosToken; now an EVM ERC20 from the 3route registry ---
export interface ThreeRouteToken {
  readonly address: EvmAddress;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
}

// --- swap — was the gist's SwapParams {input, output, hops}; now the 1inch-v6.1 /swap response ---
export interface SwapTx {
  from: string;
  to: EvmAddress; // router
  data: Hex; // ready calldata
  value: string;
  gas: string;
  gasPrice: string;
}
export interface SwapResponse {
  srcAmount: string; // amountIn to pay/approve (strict — the calldata is exact-input)
  dstAmount: string; // expected output amount
  dstAmountMin?: string; // guaranteed minimum output (amountOutMin in calldata); optional for older servers
  tx: SwapTx; // router calldata          (replaces hops)
}
