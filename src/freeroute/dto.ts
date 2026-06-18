import type { EvmAddress, Hex } from '../primitives.js';
import type { Quote, Swap, SwapTx } from './models.js';

export interface QuoteResponseDto {
  readonly srcAmount: string;
  readonly dstAmount: string;
}

export interface SwapTxDto {
  readonly from: EvmAddress;
  readonly to: EvmAddress; // free-route router
  readonly data: Hex; // router calldata
  readonly value: string; // wei msg.value — nonzero only for native-XTZ input
  readonly gas: string;
  readonly gasPrice: string;
}

export interface SwapResponseDto extends QuoteResponseDto {
  readonly dstAmountMin: string; // guaranteed minimum output
  readonly tx: SwapTxDto;
}

export const parseQuote = (d: QuoteResponseDto): Quote => ({
  srcAmount: BigInt(d.srcAmount),
  dstAmount: BigInt(d.dstAmount),
});

export const serializeQuote = (q: Quote): QuoteResponseDto => ({
  srcAmount: q.srcAmount.toString(),
  dstAmount: q.dstAmount.toString(),
});

const parseTx = (d: SwapTxDto): SwapTx => ({
  from: d.from,
  to: d.to,
  data: d.data,
  value: BigInt(d.value),
  gas: BigInt(d.gas),
  gasPrice: BigInt(d.gasPrice),
});

const serializeTx = (t: SwapTx): SwapTxDto => ({
  from: t.from,
  to: t.to,
  data: t.data,
  value: t.value.toString(),
  gas: t.gas.toString(),
  gasPrice: t.gasPrice.toString(),
});

export const parseSwap = (d: SwapResponseDto): Swap => ({
  srcAmount: BigInt(d.srcAmount),
  dstAmount: BigInt(d.dstAmount),
  dstAmountMin: BigInt(d.dstAmountMin),
  tx: parseTx(d.tx),
});

export const serializeSwap = (s: Swap): SwapResponseDto => ({
  srcAmount: s.srcAmount.toString(),
  dstAmount: s.dstAmount.toString(),
  dstAmountMin: s.dstAmountMin.toString(),
  tx: serializeTx(s.tx),
});
