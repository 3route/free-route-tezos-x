// scripts/evm/addresses.ts — print the EVM account (derived from EVM_SK) + its XTZ gas balance + Michelson alias.
import { evmToMichelsonAlias } from '../../src/index.js';
import { evmAccount, publicClient } from './send.js';

const FAUCET = 'https://faucet.previewnet.tezosx.nomadic-labs.com'; // official Tezos X previewnet faucet (funds the 0x for gas)
const account = evmAccount();
const xtz = (Number(await publicClient.getBalance({ address: account.address })) / 1e18).toFixed(6); // EVM-side XTZ is 18 decimals
console.log(`EVM    ${account.address} · ${xtz} XTZ · alias ${evmToMichelsonAlias(account.address)}`);
console.log(`\nfaucet (top up the 0x above with EVM XTZ for gas): ${FAUCET}`);
