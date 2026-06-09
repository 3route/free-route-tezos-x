// SDK public surface — universal ERC20 -> XTZ swap + bridge (Tezos-driven). Build op batches; sign elsewhere.
export { PREVIEWNET, DEFAULTS } from './config.js';

export {
  tzToAlias,
  mutezToWei,
  weiToMutez,
  encodeApproveArgs,
  encodeSwapAndBridgePullArgs,
  SIG_APPROVE,
  SIG_SWAP_BRIDGE,
} from './translation.js';

export { quoteExactOut } from './quote.js';

export {
  NATIVE_XTZ,
  getTokens,
  getSwap,
  tokenList,
  findToken,
  assertSupported,
  swapResponseToQuote,
} from './threeroute.js';

export { buildSwapOperation, buildApproveOperation, buildBatchTransaction } from './builder.js';

export { buildSwapBridgeBatch, wrapWithApprove } from './swap.js';

export type {
  NetworkConfig,
  OpDefaults,
  Quote,
  SwapBridgeArgs,
  SwapBridgeBatch,
  Tz1Address,
  EvmAddress,
  Hex,
} from './types.js';

export type {
  ThreeRouteClient,
  TokenInfo,
  TokensResponse,
  SwapResponse,
  TransactionData,
  SwapParams,
} from './threeroute.js';
