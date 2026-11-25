/**
 * pure.test.mjs — Unit tests for agent/lib/pure.mjs.
 *
 * Runs fully offline, with no key and no network:
 *   node --test agent/test/pure.test.mjs
 *
 * Pinned vectors:
 *  - ox ERC-8021 doc vector: toDataSuffix(['baseapp','morpho'])
 *    = 0x626173656170702c6d6f7270686f0e0080218021802180218021802180218021
 *  - @celo/attribution-tags codeFromRepo('belski21-growl/idrx-payout-agent')
 *    = celo_41b8d909dcde (verified live against the SDK, 25 Nov 2026)
 *  - SDK suffix for that code (verified live against the SDK, 25 Nov 2026)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ERC8021_MARKER,
  toDataSuffix,
  fromDataSuffix,
  hasAttribution,
  tagCalldata,
  codeFromRepo,
  codeFromHostname,
  isAddress,
  parseUsdtAmount,
  parseIdrxAmount,
  formatAtomic,
  takerFee,
  checkMinNotional,
  parseQuoteResponse,
  parseApiError,
  isProofRequiredError,
  validatePayoutPlan,
} from '../lib/pure.mjs';

const RECIPIENT = '0xAC9BD03F89C71A028107809432F27CbE16DF1aF8';
const WORK_WALLET = '0x8F3E972f8006aE76D55385cF9Df8bF86160983AA';
const USDT = '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e';
const IDRX = '0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22';

// --- ERC-8021 suffix encoding -----------------------------------------------

test('toDataSuffix matches the published ox doc vector', () => {
  assert.equal(
    toDataSuffix(['baseapp', 'morpho']),
    '0x626173656170702c6d6f7270686f0e0080218021802180218021802180218021',
  );
});

test('toDataSuffix matches the @celo/attribution-tags SDK output for our code', () => {
  assert.equal(
    toDataSuffix('celo_41b8d909dcde'),
    '0x63656c6f5f343162386439303964636465110080218021802180218021802180218021',
  );
});

test('toDataSuffix single code: layout is codes || len || 0x00 || marker', () => {
  const suffix = toDataSuffix('celo_41b8d909dcde');
  assert.ok(suffix.endsWith(ERC8021_MARKER.slice(2)));
  // 'celo_41b8d909dcde' is 17 ascii chars -> len byte 0x11, schema byte 0x00
  assert.ok(suffix.endsWith(`1100${ERC8021_MARKER.slice(2)}`));
});

test('toDataSuffix rejects bad codes', () => {
  assert.throws(() => toDataSuffix(''), /at least one code/);
  assert.throws(() => toDataSuffix('HasUpper'), /invalid code/);
  assert.throws(() => toDataSuffix('has space'), /invalid code/);
  assert.throws(() => toDataSuffix('has,comma'), /invalid code/);
  assert.throws(() => toDataSuffix('a'.repeat(33)), /invalid code/);
  assert.throws(() => toDataSuffix(['ok_code', 'BAD']), /invalid code/);
});

test('fromDataSuffix round-trips toDataSuffix and decodes the ox vector', () => {
  assert.deepEqual(fromDataSuffix(toDataSuffix(['baseapp', 'morpho'])), {
    codes: ['baseapp', 'morpho'],
    schemaId: 0,
  });
  assert.deepEqual(fromDataSuffix(toDataSuffix('celo_41b8d909dcde')), {
    codes: ['celo_41b8d909dcde'],
    schemaId: 0,
  });
  // Untagged calldata decodes to null.
  assert.equal(fromDataSuffix('0xa9059cbb000000000000000000000000'), null);
  assert.equal(fromDataSuffix('0x'), null);
  assert.equal(fromDataSuffix('not hex'), null);
});

test('tagCalldata appends the suffix, merges on re-tag, never double-tags', () => {
  const call = '0xa9059cbb000000000000000000000000ac9bd03f89c71a028107809432f27cbe16df1af8';
  const tagged = tagCalldata(call, 'celo_41b8d909dcde');
  assert.ok(tagged.startsWith(call));
  assert.ok(hasAttribution(tagged, 'celo_41b8d909dcde'));
  assert.equal(fromDataSuffix(tagged).codes.length, 1);
  // Tagging again with the same code is a no-op.
  assert.equal(tagCalldata(tagged, 'celo_41b8d909dcde'), tagged);
  // Tagging with a second code merges into ONE suffix (indexers read only the last tag).
  const merged = tagCalldata(tagged, 'celo_000000000000');
  assert.deepEqual(fromDataSuffix(merged).codes, ['celo_41b8d909dcde', 'celo_000000000000']);
  assert.equal((merged.match(/80218021802180218021802180218021/g) ?? []).length, 1);
  // Empty calldata (plain value transfer) still gets tagged.
  const plain = tagCalldata('0x', 'celo_41b8d909dcde');
  assert.equal(plain, toDataSuffix('celo_41b8d909dcde'));
});

// --- Code derivation --------------------------------------------------------

test('codeFromRepo matches the SDK for this repo (pinned vector)', () => {
  assert.equal(codeFromRepo('belski21-growl/idrx-payout-agent'), 'celo_41b8d909dcde');
  assert.equal(codeFromRepo('https://github.com/belski21-growl/idrx-payout-agent'), 'celo_41b8d909dcde');
  assert.equal(codeFromRepo('Belski21-Growl/IDRX-Payout-Agent'), 'celo_41b8d909dcde');
});

test('codeFromRepo rejects garbage', () => {
  assert.throws(() => codeFromRepo(''), /required/);
  assert.throws(() => codeFromRepo('no-slash'), /expected "owner\/repo"/);
  assert.throws(() => codeFromRepo('a/b/c'), /expected "owner\/repo"/);
});

test('codeFromHostname matches the SDK doc vector', () => {
  assert.equal(codeFromHostname('mondeto.app'), 'celo_b057492a5aa5');
  assert.equal(codeFromHostname('WWW.Mondeto.App'), 'celo_b057492a5aa5');
  assert.throws(() => codeFromHostname('not a host!'), /invalid hostname/);
});

// --- Addresses & amounts -----------------------------------------------------

test('isAddress validates EVM addresses', () => {
  assert.equal(isAddress(RECIPIENT), true);
  assert.equal(isAddress(WORK_WALLET), true);
  assert.equal(isAddress('0xac9bd03f89c71a028107809432f27cbe16df1af8'), true); // lowercase ok
  assert.equal(isAddress('0xAC9BD03F89C71A028107809432F27CbE16DF1aF'), false); // short
  assert.equal(isAddress('AC9BD03F89C71A028107809432F27CbE16DF1aF8'), false); // no 0x
  assert.equal(isAddress(''), false);
  assert.equal(isAddress(null), false);
});

test('parseUsdtAmount: 0.10 USD₮ = 100000 atomic (6 dp)', () => {
  assert.equal(parseUsdtAmount('0.10'), 100000n);
  assert.equal(parseUsdtAmount('1'), 1000000n);
  assert.equal(parseUsdtAmount('0.000001'), 1n);
  assert.throws(() => parseUsdtAmount('0.0000001'), /more than 6 decimal/);
  assert.throws(() => parseUsdtAmount('0'), /must be > 0/);
  assert.throws(() => parseUsdtAmount('-1'), /invalid decimal/);
  assert.throws(() => parseUsdtAmount('abc'), /invalid decimal/);
});

test('parseIdrxAmount: IDRX has 2 dp', () => {
  assert.equal(parseIdrxAmount('1.50'), 150n);
  assert.equal(parseIdrxAmount('1600'), 160000n);
  assert.throws(() => parseIdrxAmount('1.234'), /more than 2 decimal/);
});

test('formatAtomic round-trips parse', () => {
  assert.equal(formatAtomic(100000n, 6), '0.1');
  assert.equal(formatAtomic(160000n, 2), '1600');
  assert.equal(formatAtomic(parseUsdtAmount('0.10'), 6), '0.1');
});

// --- Fees & minimum size ------------------------------------------------------

test('takerFee is 2 bps', () => {
  assert.equal(takerFee(1000000n), 200n); // 1.00 USD₮ -> fee 0.0002 USD₮
  assert.equal(takerFee(100000n), 20n); // 0.10 USD₮ -> fee 0.00002 USD₮
});

test('checkMinNotional: 0.10 USD₮ is below the $1 mainnet floor, 1.00 passes', () => {
  const small = checkMinNotional({ sellAtomic: 100000n, sellDecimals: 6 });
  assert.equal(small.ok, false);
  assert.match(small.reason, /below_minimum/);
  assert.equal(small.notionalUsd, 0.1);
  const ok = checkMinNotional({ sellAtomic: 1000000n, sellDecimals: 6 });
  assert.equal(ok.ok, true);
  assert.equal(ok.notionalUsd, 1);
});

// --- RFQ response parsing ------------------------------------------------------

test('parseQuoteResponse handles a quoted response', () => {
  const body = {
    data: {
      rfqId: 'rfq_test123',
      claimToken: 'rfqc_test123',
      status: 'quoted',
      quote: {
        sellAmount: '100000',
        buyAmount: '160000',
        feeAmount: '20',
        takerPays: '100000',
        rateRay: '1600000000000000000000000000',
        expiresAt: '2026-11-25T12:00:27.000Z',
        orderDeadline: '2026-11-25T12:00:30.000Z',
        reactor: '0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3',
        taker: WORK_WALLET,
        encodedOrder: '0x1234',
        signature: '0x5678',
        orders: [],
      },
      transactions: {
        approval: { to: USDT, data: '0x095ea7b3', value: '0', chainId: 42220 },
        swap: { to: '0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3', data: '0xabcdef', value: '0', chainId: 42220 },
      },
    },
  };
  const q = parseQuoteResponse(body);
  assert.equal(q.kind, 'quoted');
  assert.equal(q.rfqId, 'rfq_test123');
  assert.equal(q.quote.buyAmount, '160000');
  assert.equal(q.transactions.swap.data, '0xabcdef');
});

test('parseQuoteResponse handles no_quote with reason + depth', () => {
  const q = parseQuoteResponse({
    data: { rfqId: 'rfq_x', claimToken: 'rfqc_x', status: 'no_quote', reason: 'no_valid_quote', availableSellAmount: '800000000' },
  });
  assert.equal(q.kind, 'no_quote');
  assert.equal(q.reason, 'no_valid_quote');
  assert.equal(q.availableSellAmount, '800000000');
});

test('parseQuoteResponse handles preview', () => {
  const q = parseQuoteResponse({
    data: { status: 'preview', sellAmount: '100000', buyAmount: '160000', feeAmount: '20', takerPays: '100000', rateRay: '1', availableSellAmount: '4200000000' },
  });
  assert.equal(q.kind, 'preview');
  assert.equal(q.buyAmount, '160000');
});

test('parseQuoteResponse rejects malformed bodies', () => {
  assert.throws(() => parseQuoteResponse(null), /no data object/);
  assert.throws(() => parseQuoteResponse({}), /no data object/);
  assert.throws(() => parseQuoteResponse({ data: { status: 'weird' } }), /unknown status/);
  assert.throws(
    () => parseQuoteResponse({ data: { status: 'quoted', quote: { sellAmount: '1' }, transactions: {} } }),
    /missing quote\./,
  );
});

test('parseApiError + isProofRequiredError detect the 401 proof challenge', () => {
  const p = parseApiError(401, { error: { details: { reason: 'proof_of_control_required' } } });
  assert.equal(isProofRequiredError(p), true);
  assert.equal(isProofRequiredError(parseApiError(401, { error: { message: 'nope' } })), false);
  assert.equal(isProofRequiredError(parseApiError(400, { error: { details: { reason: 'proof_of_control_required' } } })), false);
});

// --- Payout plan validation ----------------------------------------------------

test('validatePayoutPlan accepts the real plan, flags the $1 floor on 0.10', () => {
  const plan = validatePayoutPlan({ sellAmountUsdt: '0.10', taker: WORK_WALLET, recipient: RECIPIENT });
  assert.equal(plan.sellAtomic, '100000');
  assert.equal(plan.minNotional.ok, false); // 0.10 < $1 floor — live API is authoritative
  const ok = validatePayoutPlan({ sellAmountUsdt: '1.00', taker: WORK_WALLET, recipient: RECIPIENT });
  assert.equal(ok.minNotional.ok, true);
});

test('validatePayoutPlan rejects self-payout and bad addresses', () => {
  assert.throws(
    () => validatePayoutPlan({ sellAmountUsdt: '1', taker: WORK_WALLET, recipient: WORK_WALLET }),
    /must differ/,
  );
  assert.throws(
    () => validatePayoutPlan({ sellAmountUsdt: '1', taker: 'not-an-address', recipient: RECIPIENT }),
    /not a valid EVM address/,
  );
  assert.throws(
    () => validatePayoutPlan({ sellAmountUsdt: '0', taker: WORK_WALLET, recipient: RECIPIENT }),
    /must be > 0/,
  );
});

// --- Pure encoder vs official SDK (skipped gracefully if SDK not installed) ----

test('pure toDataSuffix matches @celo/attribution-tags SDK (when installed)', async () => {
  let sdk;
  try {
    sdk = await import('@celo/attribution-tags');
  } catch {
    test.skip('SDK not installed');
    return;
  }
  for (const codes of [['celo_41b8d909dcde'], ['baseapp', 'morpho'], ['celo_41b8d909dcde', 'celo_000000000000']]) {
    assert.equal(toDataSuffix(codes), sdk.toDataSuffix(codes));
  }
  assert.equal(codeFromRepo('belski21-growl/idrx-payout-agent'), sdk.codeFromRepo('belski21-growl/idrx-payout-agent'));
});
