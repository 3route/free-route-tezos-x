import type { EvmAddress, Hex } from '../primitives.js';

export interface ThreeRouteToken {
  readonly address: EvmAddress;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
}

export interface Quote {
  readonly srcAmount: bigint;
  readonly dstAmount: bigint;
}

export interface SwapTx {
  readonly from: EvmAddress;
  readonly to: EvmAddress;
  readonly data: Hex;
  readonly value: bigint;
  readonly gas: bigint;
  readonly gasPrice: bigint;
}

export interface Swap {
  readonly srcAmount: bigint;
  readonly dstAmount: bigint;
  readonly dstAmountMin: bigint;
  readonly tx: SwapTx;
}
