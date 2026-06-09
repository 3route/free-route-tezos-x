// Compile (solc + OZ from node_modules) and deploy the hardened SwapBridge to Tezos X previewnet.
// Reads EVM_PK from the repo-root ../.env and writes the new address back as TD_SWAPBRIDGE2.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { ethers } from 'ethers';

const SOLC = '/Users/maxima-net/.local/bin/solc';
const EVM_RPC = 'https://evm.previewnet.tezosx.nomadic-labs.com';
const envUrl = new URL('../.env', import.meta.url);

const env: Record<string, string> = {};
for (const line of readFileSync(envUrl, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1] as string] = m[2] as string;
}
const EVM_PK = env.EVM_PK;
if (!EVM_PK) throw new Error('missing EVM_PK in .env');

// compile with OZ imports resolved from ./node_modules
const out = JSON.parse(
  execSync(`${SOLC} --include-path node_modules --base-path . --combined-json abi,bin --optimize src/SwapBridge.sol`, {
    cwd: new URL('.', import.meta.url),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }),
) as { contracts: Record<string, { abi: string | unknown[]; bin: string }> };
const key = Object.keys(out.contracts).find((k) => k.endsWith(':SwapBridge'));
if (!key) throw new Error('SwapBridge not found in solc output');
const entry = out.contracts[key]!;
const abi = typeof entry.abi === 'string' ? JSON.parse(entry.abi) : entry.abi; // solc combined-json: abi may be string or object
const bin = entry.bin;
console.log(`compiled SwapBridge (${bin.length / 2} bytes)`);

const provider = new ethers.JsonRpcProvider(EVM_RPC, undefined, { batchMaxCount: 1 });
const wallet = new ethers.Wallet(EVM_PK, provider);
console.log('deployer:', wallet.address);
const contract = await new ethers.ContractFactory(abi, bin, wallet).deploy({ gasLimit: 12_000_000n });
await contract.waitForDeployment();
const addr = await contract.getAddress();
console.log('SwapBridge v2 deployed:', addr);

// persist as TD_SWAPBRIDGE2 in ../.env (replace existing line or append)
let text = readFileSync(envUrl, 'utf8');
text = /^TD_SWAPBRIDGE2=.*$/m.test(text)
  ? text.replace(/^TD_SWAPBRIDGE2=.*$/m, `TD_SWAPBRIDGE2=${addr}`)
  : `${text.trimEnd()}\nTD_SWAPBRIDGE2=${addr}\n`;
writeFileSync(envUrl, text);
console.log('wrote TD_SWAPBRIDGE2 to .env');
