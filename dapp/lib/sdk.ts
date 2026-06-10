// Thin adapter over the pure-SDK (../sdk). The dApp uses the SDK's helpers verbatim; the only dApp-specific
// bit is pointing ThreeRouteApi at the same-origin Next proxy (/api/v6.1/...) to avoid browser CORS to the server.
export { NATIVE_XTZ, SWAP_SIG, ThreeRouteApi, tzToAlias, buildCallEvm, wrapOperationParamsWithEvmApprove } from '@sdk/helpers.js';
export type { ThreeRouteToken, SwapResponse, ObjktContract, ObjktContractFulfillAskParams, EvmAddress, MichelsonAddress, Hex } from '@sdk/types.js';

import { ThreeRouteApi } from '@sdk/helpers.js';
import { CFG } from './config';

// baseUrl '' -> requests hit `/api/v6.1/{chain}/...` on this origin (the proxy forwards to RS_API server-side).
export const threeRoute = new ThreeRouteApi('', CFG.chainId);
