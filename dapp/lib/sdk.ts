// Thin adapter over 3route-tezosx (../sdk). The only dApp-specific bit is pointing the client at the
// same-origin Next proxy (baseUrl '') so browser requests avoid CORS to the 3route server.
export {
  XTZ,
  XTZ_ADDRESS,
  isXtz,
  toEvm,
  fromEvm,
  targetForMinOut,
  ThreeRouteTezosX,
  ThreeRouteClient,
  michelsonToAlias,
  aliasOf,
  objkt,
  buildSwapOperation,
  buildBatchTransaction,
  readAllowance,
  selectApproval,
  resolveApproval,
  tezosXPreviewnet,
  xtzWeiToMutez,
  xtzMutezToWei,
} from '@sdk/index.js';
export type { ThreeRouteToken, SwapResponse, QuoteResponse, SwapDetails, ApprovalMode, EvmAddress, MichelsonAddress, Hex } from '@sdk/index.js';

import { ThreeRouteTezosX, tezosXPreviewnet } from '@sdk/index.js';

// baseUrl '' -> requests hit `/api/v6.1/{chain}/...` on this origin (the Next proxy forwards to THREE_ROUTE_API);
// the preset supplies chainId + gateway.
export const swapper = new ThreeRouteTezosX({ network: tezosXPreviewnet, baseUrl: '' });
export const threeRoute = swapper.client; // raw client for token registry + rate quotes
