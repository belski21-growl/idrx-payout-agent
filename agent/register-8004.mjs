/**
 * register-8004.mjs — Register this agent on the ERC-8004 Identity Registry
 * (Celo mainnet, 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432).
 *
 * Flow (per docs.celo.org/build-on-celo/build-with-ai/8004):
 *   1. Publish the registration JSON file (agent/registration.json) at a
 *      public URL FIRST (any HTTPS URL, IPFS, or data: URI — the spec does
 *      not mandate a path). The file initially has NO "registrations" entry:
 *      you only learn the agent ID once the registration is mined.
 *   2. Run this script: it sends register(agentURI) — 1 tx, tagged with the
 *      ERC-8021 attribution suffix like every tx this agent sends.
 *   3. Read the agent ID from the `Registered` event on the receipt
 *      (NOT from the return value of a simulated call — anyone else
 *      registering first would make a simulated value wrong).
 *   4. Update registration.json with the real agent ID under
 *      "registrations" (chain 42220, registry address, agentId), re-publish
 *      the file, then run this script with --set-uri to point the registry
 *      at the updated file: setAgentURI(agentId, newURI).
 *
 * DO NOT RUN THIS until the coordinator/parent says so — it sends a real
 * mainnet transaction. Without CELO_WORK_KEY it exits with a clear message.
 * With --dry-run it prints the exact calldata and cost estimate and sends
 * nothing.
 *
 * Usage:
 *   node agent/register-8004.mjs --dry-run --uri https://<host>/registration.json
 *   CELO_WORK_KEY=0x... node agent/register-8004.mjs --uri https://<host>/registration.json
 *   CELO_WORK_KEY=0x... node agent/register-8004.mjs --set-uri <agentId> --uri https://<host>/registration.json
 *
 * Env: CELO_WORK_KEY (required for live runs), CELO_RPC_URL (optional),
 *      LOOPS_ATTRIBUTION_CODE (optional, added alongside the repo code).
 */

import { createPublicClient, createWalletClient, http, parseAbi, encodeFunctionData, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo } from 'viem/chains';
import { toDataSuffix as sdkToDataSuffix } from '@celo/attribution-tags';
import { toDataSuffix, tagCalldata, codeFromRepo } from './lib/pure.mjs';
import { CHAIN_ID, RPC_URL, IDENTITY_REGISTRY, WORK_WALLET, REPO_SLUG, ATTRIBUTION_CODE } from './lib/config.mjs';

// Minimal ABI for the two calls we make (EIP-8004 Identity Registry).
const REGISTRY_ABI = parseAbi([
  'function register(string agentURI) returns (uint256 agentId)',
  'function setAgentURI(uint256 agentId, string newAgentURI)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'event Registered(uint256 indexed agentId, address indexed agentAddress, string agentURI)',
]);

const REGISTERED_TOPIC = keccak256(toHex('Registered(uint256,address,string)'));

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function fail(message, code = 1) {
  console.error(`ERROR: ${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { dryRun: false, setUri: null, uri: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--uri') out.uri = argv[++i];
    else if (a === '--set-uri') out.setUri = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(`Usage:
  node agent/register-8004.mjs --dry-run --uri https://<host>/registration.json
  CELO_WORK_KEY=0x... node agent/register-8004.mjs --uri https://<host>/registration.json
  CELO_WORK_KEY=0x... node agent/register-8004.mjs --set-uri <agentId> --uri https://<host>/registration.json`);
      process.exit(0);
    } else fail(`unknown argument: ${a}`, 2);
  }
  if (!out.uri) fail('--uri <agentURI> is required (the public URL of registration.json)', 2);
  if (!/^https?:\/\//.test(out.uri) && !out.uri.startsWith('ipfs://') && !out.uri.startsWith('data:')) {
    fail(`--uri must be a public http(s) URL, ipfs://, or data: URI — got ${out.uri}`, 2);
  }
  return out;
}

function attributionSuffix() {
  const codes = [ATTRIBUTION_CODE];
  const loopsCode = (process.env.LOOPS_ATTRIBUTION_CODE ?? '').trim();
  if (loopsCode) {
    if (!/^[a-z0-9_]{1,32}$/.test(loopsCode)) fail(`LOOPS_ATTRIBUTION_CODE invalid: ${JSON.stringify(loopsCode)}`, 2);
    if (!codes.includes(loopsCode)) codes.push(loopsCode);
  }
  const pure = toDataSuffix(codes);
  const sdk = sdkToDataSuffix(codes);
  if (pure.toLowerCase() !== sdk.toLowerCase()) fail('attribution encoder mismatch — refusing to send', 1);
  if (codeFromRepo(REPO_SLUG) !== ATTRIBUTION_CODE) fail('ATTRIBUTION_CODE mismatch with codeFromRepo — fix config.mjs', 2);
  return { codes, suffix: pure };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { codes, suffix } = attributionSuffix();
  log(`ERC-8004 registration — Celo mainnet (${CHAIN_ID}), registry ${IDENTITY_REGISTRY}`);
  log(`Attribution code(s): ${codes.join(', ')} | suffix: ${suffix}`);
  log(`agentURI: ${args.uri}`);

  const fn = args.setUri === null ? 'register' : 'setAgentURI';
  const fnArgs = args.setUri === null ? [args.uri] : [BigInt(args.setUri), args.uri];
  const data = encodeFunctionData({ abi: REGISTRY_ABI, functionName: fn, args: fnArgs });
  const taggedData = tagCalldata(data, codes);

  if (args.dryRun) {
    log('DRY RUN — nothing will be sent.');
    log(`Call: ${fn}(${fnArgs.map((a) => String(a)).join(', ')})`);
    log(`Calldata (tagged): ${taggedData}`);
    log('Next live step: CELO_WORK_KEY=0x... node agent/register-8004.mjs --uri <same URI>');
    return;
  }

  const key = process.env.CELO_WORK_KEY;
  if (!key) {
    fail('CELO_WORK_KEY belum di-set — set it in the environment to register (never paste a key into a file, chat, or this repo).', 2);
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key.trim())) fail('CELO_WORK_KEY is not a 0x-prefixed 64-hex private key.', 2);
  const account = privateKeyToAccount(key.trim());
  if (account.address.toLowerCase() !== WORK_WALLET.toLowerCase()) {
    fail(`CELO_WORK_KEY belongs to ${account.address}, not the work wallet ${WORK_WALLET} — refusing.`, 2);
  }

  const pub = createPublicClient({ chain: celo, transport: http(RPC_URL) });
  const wallet = createWalletClient({ account, chain: celo, transport: http(RPC_URL) });

  // Pre-flight: if setAgentURI, the caller must own the agent NFT.
  if (args.setUri !== null) {
    const owner = await pub.readContract({ address: IDENTITY_REGISTRY, abi: REGISTRY_ABI, functionName: 'ownerOf', args: [BigInt(args.setUri)] });
    if (owner.toLowerCase() !== account.address.toLowerCase()) {
      fail(`agent ${args.setUri} is owned by ${owner}, not ${account.address} — cannot setAgentURI`, 1);
    }
  }

  const hash = await wallet.sendTransaction({ account, to: IDENTITY_REGISTRY, data: taggedData, value: 0n });
  log(`Transaction sent: ${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  log(`Confirmed in block ${receipt.blockNumber} (gas used ${receipt.gasUsed}, status ${receipt.status})`);
  if (receipt.status !== 'success') fail(`registration tx reverted: ${hash}`, 1);

  if (args.setUri === null) {
    // Agent ID comes from the Registered event on the receipt — never from a simulated return value.
    const registered = receipt.logs.find(
      (l) => l.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase() && l.topics[0] === REGISTERED_TOPIC,
    );
    if (!registered || !registered.topics[1]) {
      fail(`no Registered event found in receipt ${hash} — agent ID unknown. Check the tx on Celoscan before retrying.`, 1);
    }
    const agentId = BigInt(registered.topics[1]).toString();
    log(`REGISTERED — agent ID: ${agentId}`);
    log('Next steps:');
    log(`  1. Add to agent/registration.json under "registrations": { "chainId": 42220, "registry": "${IDENTITY_REGISTRY}", "agentId": ${agentId} }`);
    log('  2. Re-publish registration.json at the same URL (or a new one).');
    log(`  3. Run: CELO_WORK_KEY=0x... node agent/register-8004.mjs --set-uri ${agentId} --uri <final URL>`);
    log(`  4. Verify at https://8004scan.io (agent ${agentId}) and record the ID in README + evidence.`);
  } else {
    log(`agentURI updated for agent ${args.setUri}. Verify at https://8004scan.io.`);
  }
}

main().catch((e) => {
  console.error('FATAL:', e?.message ?? e);
  process.exit(1);
});
