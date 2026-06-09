// PROBE (read-mostly, one tiny tx): does native XTZ sent to a tz1's EVM alias auto-forward to the tz1's
// Michelson balance? This is the make-or-break for the contract-less ("pure SDK") path: if a 3route swap can
// send native to `to=alias` and it lands on the buyer's tz1, no SwapBridge is needed.
// Isolated from the swap: we just send native to the alias from the funded EOA and watch three balances.
// Run: npx tsx pure-sdk-spike/probe-autoforward.ts   (uses repo-root ../.env + node_modules)
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';

const EVM_RPC = 'https://evm.previewnet.tezosx.nomadic-labs.com';
const TZKT = 'https://api.previewnet.tezosx.tzkt.io/v1';
const TZ1 = 'tz1QPS1T1g2eiLptTSG6qLTK1789Cwt1rH3e'; // buyer (implicit)
const ALIAS = '0x8B02895450dE0ce6B44160A2D0f1B2C84198DFa3'; // tz1's EVM address (getTezosEthereumAddress)
const KT1_ALIAS = 'KT1GVdM3RynrFmRshDBQtAW6eAUh8uMwQa36'; // Michelson form of the alias (getEthereumTezosAddress)
const SEND_WEI = 1_000_000_000_000_000n; // 0.001 XTZ

const env: Record<string, string> = {};
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1] as string] = m[2] as string;
}
const provider = new ethers.JsonRpcProvider(EVM_RPC, undefined, { batchMaxCount: 1 });
const wallet = new ethers.Wallet(env.EVM_PK as string, provider);

const evmBal = (a: string) => provider.getBalance(a);
const mutezBal = async (a: string): Promise<bigint> =>
  BigInt(await fetch(`${TZKT}/accounts/${a}/balance`).then((r) => r.text()).catch(() => '0'));

async function snapshot(label: string) {
  const [aliasEvm, tz1, kt1] = await Promise.all([evmBal(ALIAS), mutezBal(TZ1), mutezBal(KT1_ALIAS)]);
  console.log(`[${label}] alias EVM(wei)=${aliasEvm}  tz1(mutez)=${tz1}  KT1alias(mutez)=${kt1}`);
  return { aliasEvm, tz1, kt1 };
}

console.log(`EOA ${wallet.address} -> send 0.001 XTZ to alias ${ALIAS}`);
const before = await snapshot('before');

const tx = await wallet.sendTransaction({ to: ALIAS, value: SEND_WEI, gasLimit: 1_000_000n }); // generous gas (mimic 3route .call{value})
console.log('  tx:', tx.hash);
await tx.wait();
await new Promise((r) => setTimeout(r, 6_000));

const after = await snapshot('after');
console.log('\n=== deltas ===');
console.log(`alias EVM native: ${after.aliasEvm - before.aliasEvm} wei`);
console.log(`tz1 Michelson:    ${after.tz1 - before.tz1} mutez`);
console.log(`KT1alias Michelson:${after.kt1 - before.kt1} mutez`);
console.log(
  after.tz1 - before.tz1 >= SEND_WEI / 10n ** 12n - 100n
    ? '\n=> AUTO-FORWARD to tz1 WORKS — contract-less path viable.'
    : after.aliasEvm > before.aliasEvm
      ? '\n=> native STAYS on the alias EVM balance — NO auto-forward to tz1 (contract/bridge needed).'
      : '\n=> landed elsewhere (see KT1alias) — inspect.',
);
