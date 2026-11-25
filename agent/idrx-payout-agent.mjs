/**
 * idrx-payout-agent.mjs — IDRX Payout Agent (Celo mainnet, chain 42220).
 *
 * Product flow:
 *   1. Check USD₮ / CELO balances of the work wallet.
 *   2. Preview a Textile RFQ quote for USD₮ -> IDRX (free, no key needed).
 *   3. Request a firm quote (keyless: EIP-712 "Textile Taker Control" proof,
 *      signed by the work wallet; valid ~12 h once verified).
 *   4. Approve USD₮ to the Textile reactor (once, only if allowance is short).
 *   5. Submit the swap (broadcast transactions.swap exactly as returned).
 *   6. Transfer ALL IDRX received to the named recipient (outside the team).
 *   7. Write an evidence JSON file (quote, tx hashes, blocks, amounts, fees).
 *
 * EVERY transaction this agent sends carries the ERC-8021 attribution tag
 * (Schema 0 suffix, code celo_41b8d909dcde [+ the Loops-issued code when set])
 * appended to its calldata. The suffix is invisible to the called contract
 * (the EVM discards trailing bytes) and is read by indexers.
 *
 * Secrets: the wallet key comes ONLY from the CELO_WORK_KEY env var.
 * The script NEVER reads a key file and NEVER creates a wallet.
 * Without a key it refuses to run any live step — use --dry-run to preview
 * the quote and the plan without a key and without sending anything.
 *
 * Usage:
 *   node agent/idrx-payout-agent.mjs --dry-run
 *   CELO_WORK_KEY=0x... node agent/idrx-payout-agent.mjs [--amount 0.10] [--recipient 0x...]
 *   CELO_WORK_KEY=0x... node agent/idrx-payout-agent.mjs --yes   # skip the confirm prompt
 *
 * Env:
 *   CELO_WORK_KEY          hex private key of the work wallet (required for live runs)
 *   CELO_RPC_URL           Celo RPC endpoint (default https://forno.celo.org)
 *   LOOPS_ATTRIBUTION_CODE attribution code issued by Loops House at enrollment (optional, added alongside the repo-derived code)
 *   TEXTILE_API_KEY        partner API key (optional; when set, no takerProof is signed)
 */

import { randomBytes, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import readline from 'node:readline';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  encodeFunctionData,
  erc20Abi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo } from 'viem/chains';
import { toDataSuffix as sdkToDataSuffix } from '@celo/attribution-tags';
import {
  toDataSuffix,
  tagCalldata,
  codeFromRepo,
  parseQuoteResponse,
  parseApiError,
  isProofRequiredError,
  validatePayoutPlan,
  checkMinNotional,
  parseUsdtAmount,
  formatAtomic,
  TEXTILE_API_BASE,
} from './lib/pure.mjs';
import {
  CHAIN_ID,
  RPC_URL,
  TOKENS,
  TEXTILE_REACTOR,
  WORK_WALLET,
  RECIPIENT,
  REPO_SLUG,
  ATTRIBUTION_CODE,
  DEFAULT_SELL_USDT,
  EVIDENCE_DIR,
} from './lib/config.mjs';

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
]);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function fail(message, code = 1) {
  console.error(`ERROR: ${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { dryRun: false, yes: false, amount: DEFAULT_SELL_USDT, recipient: RECIPIENT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--yes') out.yes = true;
    else if (a === '--amount') out.amount = argv[++i];
    else if (a === '--recipient') out.recipient = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(`Usage:
  node agent/idrx-payout-agent.mjs --dry-run
  CELO_WORK_KEY=0x... node agent/idrx-payout-agent.mjs [--amount 0.10] [--recipient 0x...] [--yes]

Options:
  --dry-run     Preview the quote + plan only. No key needed, nothing is sent.
  --amount      Exact-input USD₮ size (default ${DEFAULT_SELL_USDT}).
                NOTE: Textile's mainnet dollar floor is $1 — 0.10 will very
                likely come back below-minimum / no_quote. See README § "Minimum swap".
  --recipient   IDRX payout recipient (default ${RECIPIENT}).
  --yes         Skip the interactive confirmation before sending transactions.`);
      process.exit(0);
    } else fail(`unknown argument: ${a}\nRun with --help for usage.`, 2);
  }
  return out;
}

async function confirm(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(`${message} [y/N] `, resolve));
  rl.close();
  return answer.trim().toLowerCase() === 'y';
}

/** Attribution suffix for this run (repo code + Loops-issued code when set). */
function attributionSuffix() {
  const codes = [ATTRIBUTION_CODE];
  const loopsCode = (process.env.LOOPS_ATTRIBUTION_CODE ?? '').trim();
  if (loopsCode) {
    if (!/^[a-z0-9_]{1,32}$/.test(loopsCode)) {
      fail(`LOOPS_ATTRIBUTION_CODE is not a valid attribution code: ${JSON.stringify(loopsCode)}`, 2);
    }
    if (!codes.includes(loopsCode)) codes.push(loopsCode);
  }
  // Cross-check our pure encoder against the official SDK once per run.
  const pure = toDataSuffix(codes);
  const sdk = sdkToDataSuffix(codes);
  if (pure.toLowerCase() !== sdk.toLowerCase()) {
    fail(`attribution encoder mismatch: pure ${pure} != SDK ${sdk} — refusing to send untagged/mistagged txs`, 1);
  }
  if (codeFromRepo(REPO_SLUG) !== ATTRIBUTION_CODE) {
    fail(`ATTRIBUTION_CODE ${ATTRIBUTION_CODE} does not match codeFromRepo(${REPO_SLUG}) — fix config.mjs`, 2);
  }
  return { codes, suffix: pure };
}

// ---------------------------------------------------------------------------
// Textile RFQ API v2 (keyless path)
// ---------------------------------------------------------------------------

async function textileFetch(path, { method = 'POST', body = null, headers = {} } = {}) {
  const apiKey = process.env.TEXTILE_API_KEY;
  const res = await fetch(`${TEXTILE_API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...headers,
    },
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(75_000), // docs: firm requests can hold ~70 s
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

/**
 * Sign the EIP-712 "Textile Taker Control" v1 challenge (free, moves no funds).
 * Domain: { name: "Textile Taker Control", version: "1", chainId }.
 */
async function signTakerControl(account, chainId) {
  const nonce = `0x${randomBytes(32).toString('hex')}`;
  const issuedAt = Date.now(); // Unix milliseconds
  const signature = await account.signTypedData({
    domain: { name: 'Textile Taker Control', version: '1', chainId },
    types: {
      TakerControl: [
        { name: 'taker', type: 'address' },
        { name: 'chainId', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
        { name: 'issuedAt', type: 'uint256' },
      ],
    },
    primaryType: 'TakerControl',
    message: {
      taker: account.address,
      chainId: BigInt(chainId),
      nonce,
      issuedAt: BigInt(issuedAt),
    },
  });
  return { nonce, issuedAt, signature };
}

/**
 * Request a firm quote. Keyless flow per the docs: send unsigned first;
 * if the API answers 401 proof_of_control_required, sign TakerControl once
 * and resend. A verified proof covers this wallet + chain for ~12 h.
 */
async function requestFirmQuote({ account, sellAmount }) {
  const baseBody = {
    chainId: CHAIN_ID,
    sellToken: TOKENS.USDT,
    buyToken: TOKENS.IDRX,
    sellAmount: sellAmount.toString(),
    taker: account.address,
  };
  let { status, json } = await textileFetch('/rfq/request', { body: baseBody });
  if (status === 401) {
    const parsed = parseApiError(status, json);
    if (!isProofRequiredError(parsed)) fail(`RFQ request rejected: HTTP 401 ${parsed.reason}`, 1);
    log('No proof grant yet — signing the free "Textile Taker Control" proof...');
    const takerProof = await signTakerControl(account, CHAIN_ID);
    ({ status, json } = await textileFetch('/rfq/request', { body: { ...baseBody, takerProof } }));
  }
  if (status === 400) {
    const parsed = parseApiError(status, json);
    return { kind: 'rejected_400', reason: parsed.reason, raw: json };
  }
  if (status !== 200) {
    const parsed = parseApiError(status, json);
    fail(`RFQ request failed: HTTP ${status} ${parsed.reason}`, 1);
  }
  return parseQuoteResponse(json);
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { codes, suffix } = attributionSuffix();
  log(`IDRX Payout Agent — Celo mainnet (${CHAIN_ID})`);
  log(`Attribution code(s): ${codes.join(', ')} | suffix: ${suffix}`);

  // Validate the plan before touching the network or any key.
  const plan = validatePayoutPlan({
    sellAmountUsdt: args.amount,
    taker: WORK_WALLET,
    recipient: args.recipient,
  });
  const sellAtomic = BigInt(plan.sellAtomic);
  log(`Plan: swap ${args.amount} USD₮ -> IDRX, pay all IDRX to ${args.recipient}`);
  if (!plan.minNotional.ok) {
    log(`WARNING: ${plan.minNotional.reason}`);
    log('The live preview below is authoritative — if it also refuses, the run stops here with evidence.');
  }

  const evidence = {
    agent: 'idrx-payout-agent',
    repo: REPO_SLUG,
    chainId: CHAIN_ID,
    taker: WORK_WALLET,
    recipient: args.recipient,
    sellAmountUsdt: args.amount,
    sellAtomic: sellAtomic.toString(),
    attributionCodes: codes,
    attributionSuffix: suffix,
    mode: args.dryRun ? 'dry-run' : 'live',
    startedAt: new Date().toISOString(),
    steps: {},
  };

  const pub = createPublicClient({ chain: celo, transport: http(RPC_URL) });

  // 1. Balances (public RPC read, no key).
  const [usdtBal, celoBal, idrxBalBefore] = await Promise.all([
    pub.readContract({ address: TOKENS.USDT, abi: ERC20_ABI, functionName: 'balanceOf', args: [WORK_WALLET] }),
    pub.getBalance({ address: WORK_WALLET }),
    pub.readContract({ address: TOKENS.IDRX, abi: ERC20_ABI, functionName: 'balanceOf', args: [WORK_WALLET] }),
  ]);
  evidence.steps.balances = {
    usdt: usdtBal.toString(),
    usdtHuman: formatAtomic(usdtBal, 6),
    celoWei: celoBal.toString(),
    idrxBefore: idrxBalBefore.toString(),
  };
  log(`Balances — USD₮ ${formatAtomic(usdtBal, 6)} | CELO ${formatAtomic(celoBal, 18)} | IDRX ${formatAtomic(idrxBalBefore, 2)}`);
  if (!args.dryRun && usdtBal < sellAtomic) {
    fail(`insufficient USD₮: have ${formatAtomic(usdtBal, 6)}, need ${args.amount}. Claim the faucet first (see README) — nothing was sent.`, 1);
  }

  // 2. Preview (free estimate, no taker, no signature).
  log('Requesting Textile preview quote (USD₮ -> IDRX)...');
  const previewRes = await textileFetch('/rfq/preview', {
    body: { chainId: CHAIN_ID, sellToken: TOKENS.USDT, buyToken: TOKENS.IDRX, sellAmount: sellAtomic.toString() },
  });
  if (previewRes.status !== 200) {
    const parsed = parseApiError(previewRes.status, previewRes.json);
    evidence.steps.preview = { error: parsed };
    await writeEvidence(evidence, 'preview-error');
    fail(`preview failed: HTTP ${previewRes.status} ${parsed.reason}`, 1);
  }
  const preview = parseQuoteResponse(previewRes.json);
  evidence.steps.preview = preview;
  if (preview.kind === 'no_quote') {
    log(`Preview: no_quote (${preview.reason})${preview.availableSellAmount ? ` — available sell depth ${preview.availableSellAmount}` : ''}`);
    evidence.status = 'no_quote';
    await writeEvidence(evidence, 'preview-no-quote');
    log('Stopping here: no maker would price this size. Evidence written. No transaction was sent.');
    return;
  }
  log(`Preview: sell ${formatAtomic(preview.sellAmount, 6)} USD₮ -> buy ~${formatAtomic(preview.buyAmount, 2)} IDRX | fee ${formatAtomic(preview.feeAmount, 6)} USD₮ | rateRay ${preview.rateRay}`);

  if (args.dryRun) {
    evidence.status = 'dry-run-ok';
    await writeEvidence(evidence, 'dry-run');
    log('Dry run complete. No key was used, no signature was made, nothing was sent.');
    log('To run live: CELO_WORK_KEY=0x... node agent/idrx-payout-agent.mjs --amount <size>');
    return;
  }

  // 3. Live path — key required from env only.
  const key = process.env.CELO_WORK_KEY;
  if (!key) {
    fail('CELO_WORK_KEY belum di-set — set it in the environment to run live (never paste a key into a file, chat, or this repo).', 2);
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key.trim())) {
    fail('CELO_WORK_KEY is not a 0x-prefixed 64-hex private key.', 2);
  }
  const account = privateKeyToAccount(key.trim());
  if (account.address.toLowerCase() !== WORK_WALLET.toLowerCase()) {
    fail(`CELO_WORK_KEY belongs to ${account.address}, not the configured work wallet ${WORK_WALLET} — refusing to run.`, 2);
  }
  const wallet = createWalletClient({ account, chain: celo, transport: http(RPC_URL) });

  // 4. Firm quote.
  log('Requesting firm quote...');
  const firm = await requestFirmQuote({ account, sellAmount: sellAtomic });
  if (firm.kind === 'rejected_400') {
    evidence.steps.firmQuote = firm;
    evidence.status = 'rejected_400';
    await writeEvidence(evidence, 'firm-400');
    log(`Firm request rejected (HTTP 400): ${firm.reason}`);
    log('Most likely cause at 0.10 USD₮: below the $1 mainnet dollar floor. Evidence written. Nothing was sent.');
    return;
  }
  if (firm.kind === 'no_quote') {
    evidence.steps.firmQuote = firm;
    evidence.status = 'no_quote';
    await writeEvidence(evidence, 'firm-no-quote');
    log(`Firm quote: no_quote (${firm.reason}). Evidence written. Nothing was sent.`);
    return;
  }
  evidence.steps.firmQuote = {
    rfqId: firm.rfqId,
    sellAmount: firm.quote.sellAmount,
    buyAmount: firm.quote.buyAmount,
    feeAmount: firm.quote.feeAmount,
    takerPays: firm.quote.takerPays,
    rateRay: firm.quote.rateRay,
    expiresAt: firm.quote.expiresAt,
    reactor: firm.quote.reactor,
  };
  log(`Firm quote ${firm.rfqId}: pay ${formatAtomic(firm.quote.takerPays, 6)} USD₮ -> receive ${formatAtomic(firm.quote.buyAmount, 2)} IDRX | fee ${formatAtomic(firm.quote.feeAmount, 6)} USD₮ | expires ${firm.quote.expiresAt}`);
  log(`Claim token received (kept in memory only, never logged).`);

  if (!args.yes && !(await confirm('Send the approval (if needed) + swap + IDRX payout now?'))) {
    log('Aborted by user before any transaction. The firm quote will lapse on its own.');
    evidence.status = 'aborted-by-user';
    await writeEvidence(evidence, 'aborted');
    return;
  }

  const sendTx = async (label, tx) => {
    // Tag EVERY transaction: append the ERC-8021 suffix to the calldata.
    const tagged = { ...tx, data: tagCalldata(tx.data ?? '0x', codes) };
    const hash = await wallet.sendTransaction({ ...tagged, account });
    log(`${label} sent: ${hash}`);
    const receipt = await pub.waitForTransactionReceipt({ hash });
    log(`${label} confirmed in block ${receipt.blockNumber} (gas used ${receipt.gasUsed}, status ${receipt.status})`);
    return { hash, blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), status: receipt.status };
  };

  // 5. Approve USD₮ to the reactor (only the shortfall, only once).
  const takerPays = BigInt(firm.quote.takerPays);
  const reactor = firm.quote.reactor;
  if (reactor.toLowerCase() !== TEXTILE_REACTOR.toLowerCase()) {
    fail(`quote reactor ${reactor} != expected ${TEXTILE_REACTOR} — refusing to approve a different contract`, 1);
  }
  const allowance = await pub.readContract({
    address: TOKENS.USDT, abi: ERC20_ABI, functionName: 'allowance', args: [account.address, reactor],
  });
  if (allowance < takerPays) {
    // USD₮-style tokens reject approve(non-zero -> non-zero): reset first if needed.
    if (allowance > 0n) {
      log('Resetting existing USD₮ allowance to 0 first (USDT-style approve rule)...');
      const resetData = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [reactor, 0n] });
      evidence.steps.approvalReset = await sendTx('approval-reset', { to: TOKENS.USDT, data: resetData, value: 0n });
    }
    const approvalData = firm.transactions.approval?.data
      ?? encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [reactor, takerPays] });
    const approvalTo = firm.transactions.approval?.to ?? TOKENS.USDT;
    if (approvalTo.toLowerCase() !== TOKENS.USDT.toLowerCase()) {
      fail(`quote approval targets ${approvalTo}, not USD₮ — refusing`, 1);
    }
    evidence.steps.approval = await sendTx('approval', { to: approvalTo, data: approvalData, value: 0n });
  } else {
    log('Allowance already covers takerPays — skipping approval.');
    evidence.steps.approval = { skipped: true, allowance: allowance.toString() };
  }

  // 6. Swap — recheck the accept cutoff first, then broadcast transactions.swap exactly.
  if (Date.now() >= Date.parse(firm.quote.expiresAt)) {
    fail('Quote expired during approval — request a new quote. The approval (if sent) is harmless; no swap was sent.', 1);
  }
  const swapTx = firm.transactions.swap;
  if (swapTx.to.toLowerCase() !== reactor.toLowerCase()) {
    fail(`swap target ${swapTx.to} != reactor ${reactor} — refusing`, 1);
  }
  evidence.steps.swap = await sendTx('swap', { to: swapTx.to, data: swapTx.data, value: BigInt(swapTx.value ?? '0') });

  // 7. Report the hash to Textile (courtesy; settlement is reconciled on-chain anyway).
  try {
    const { status } = await textileFetch(`/rfq/${firm.rfqId}/submit`, {
      body: { txHash: evidence.steps.swap.hash },
      headers: { 'X-Rfq-Claim': firm.claimToken ?? '' },
    });
    evidence.steps.submitReport = { httpStatus: status };
    log(`Reported swap hash to Textile (HTTP ${status}).`);
  } catch (e) {
    evidence.steps.submitReport = { error: String(e) };
    log('WARNING: could not report the swap hash to Textile — the on-chain fill is still detected by Textile. Continuing.');
  }

  // 8. Pay out ALL IDRX received to the recipient.
  const idrxBalAfter = await pub.readContract({ address: TOKENS.IDRX, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
  const idrxReceived = idrxBalAfter - idrxBalBefore;
  evidence.steps.idrxReceived = { balanceBefore: idrxBalBefore.toString(), balanceAfter: idrxBalAfter.toString(), received: idrxReceived.toString(), receivedHuman: formatAtomic(idrxReceived, 2) };
  log(`IDRX received from swap: ${formatAtomic(idrxReceived, 2)} (balance now ${formatAtomic(idrxBalAfter, 2)})`);
  if (idrxReceived <= 0n) {
    fail('Swap confirmed but IDRX balance did not increase — NOT paying out (nothing to pay). Investigate before retrying.', 1);
  }
  const payoutData = encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [args.recipient, idrxBalAfter] });
  evidence.steps.payout = await sendTx('idrx-payout', { to: TOKENS.IDRX, data: payoutData, value: 0n });
  evidence.steps.payout.amount = idrxBalAfter.toString();
  evidence.steps.payout.amountHuman = formatAtomic(idrxBalAfter, 2);
  evidence.steps.payout.recipient = args.recipient;

  evidence.status = 'completed';
  evidence.finishedAt = new Date().toISOString();
  await writeEvidence(evidence, 'completed');
  log(`DONE — paid ${formatAtomic(idrxBalAfter, 2)} IDRX to ${args.recipient}. Evidence written.`);
}

async function writeEvidence(evidence, kind) {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(EVIDENCE_DIR, `${stamp}-${kind}.json`);
  await writeFile(path, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  log(`Evidence written: ${path}`);
  return path;
}

main().catch((e) => {
  console.error('FATAL:', e?.message ?? e);
  process.exit(1);
});
