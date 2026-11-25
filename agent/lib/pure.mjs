/**
 * pure.mjs — Pure logic for the IDRX Payout Agent.
 *
 * Zero dependencies, zero network, zero secrets. Everything in here is
 * unit-testable offline with `node --test`.
 *
 * Covers:
 *  - ERC-8021 Schema 0 attribution suffix encoding/decoding
 *    (byte-identical to `ox`'s Attribution.toDataSuffix and to
 *    `@celo/attribution-tags` toDataSuffix — verified against the
 *    published ox doc vector in the test suite)
 *  - codeFromRepo / codeFromHostname derivation
 *    (trim -> lowercase -> SHA-256 -> first 6 bytes -> "celo_" prefix)
 *  - Address / amount validation and parsing (USD₮ 6 dp, IDRX 2 dp)
 *  - Textile RFQ API v2 response parsing (quoted / no_quote / errors)
 *  - Taker-fee math (2 bps on Celo) and the $1 mainnet dollar floor
 */

// ---------------------------------------------------------------------------
// ERC-8021 (attribution tags)
// ---------------------------------------------------------------------------

/** 16-byte ERC-8021 marker, repeated 0x8021 eight times. */
export const ERC8021_MARKER = '0x80218021802180218021802180218021';

/** Codes must match /^[a-z0-9_]{1,32}$/ (Celo SDK rule, stricter than ERC-8021). */
export const CODE_RE = /^[a-z0-9_]{1,32}$/;

export function validateCodes(input) {
  const arr = typeof input === 'string' ? (input === '' ? [] : [input]) : [...input];
  if (arr.length === 0) throw new Error('toDataSuffix: at least one code is required');
  for (const c of arr) {
    if (typeof c !== 'string' || !CODE_RE.test(c)) {
      throw new Error(
        `toDataSuffix: invalid code ${JSON.stringify(c)} — codes must match /^[a-z0-9_]{1,32}$/ (no spaces, no commas, no uppercase)`,
      );
    }
  }
  const joined = arr.join(',');
  if (joined.length > 255) {
    throw new Error(
      `toDataSuffix: combined codes are ${joined.length} bytes (comma-joined) — the ERC-8021 length byte caps the code field at 255 bytes`,
    );
  }
  return arr;
}

/**
 * Encode an ERC-8021 Schema 0 data suffix for one or more codes.
 * Wire layout: ascii(codes.join(',')) || len(1 byte) || schemaId 0x00 || marker(16 bytes).
 * Pure re-implementation of ox Attribution.toDataSuffix({ codes }) schema 0.
 */
export function toDataSuffix(code) {
  const codes = validateCodes(code);
  const joined = codes.join(',');
  const codesHex = Buffer.from(joined, 'ascii').toString('hex');
  const lenHex = codesHex.length / 2; // byte length of the codes field
  const lenByte = lenHex.toString(16).padStart(2, '0');
  return `0x${codesHex}${lenByte}00${ERC8021_MARKER.slice(2)}`;
}

/**
 * Decode an ERC-8021 Schema 0 suffix from the END of calldata.
 * Returns { codes, schemaId: 0 } or null when no valid Schema 0 tag is present.
 */
export function fromDataSuffix(data) {
  if (typeof data !== 'string' || !data.startsWith('0x')) return null;
  const hex = data.toLowerCase();
  const marker = ERC8021_MARKER.slice(2).toLowerCase();
  if (!hex.endsWith(marker)) return null;
  // Layout from the end: [marker 16B][schemaId 1B][len 1B][codes len B]
  const body = hex.slice(2, -marker.length); // everything before the marker
  if (body.length < 4) return null; // need at least len + schema bytes
  const schemaId = parseInt(body.slice(-2), 16);
  if (schemaId !== 0) return null; // this decoder only handles Schema 0
  const codesLen = parseInt(body.slice(-4, -2), 16);
  // The codes field sits immediately before the len byte — slice from the end,
  // not from the start (calldata precedes it and is of arbitrary length).
  const codesStart = body.length - 4 - codesLen * 2;
  if (codesStart < 0) return null;
  const codesHex = body.slice(codesStart, body.length - 4);
  if (codesHex.length !== codesLen * 2) return null;
  const codesStr = Buffer.from(codesHex, 'hex').toString('ascii');
  if (codesStr.length === 0) return null;
  const codes = codesStr.split(',');
  if (codes.some((c) => !CODE_RE.test(c))) return null;
  return { codes, schemaId };
}

/** True when `data` already ends with a valid Schema 0 suffix carrying `code`. */
export function hasAttribution(data, code) {
  const decoded = fromDataSuffix(data);
  return decoded !== null && decoded.codes.includes(code);
}

/**
 * Append the attribution suffix to calldata. If the calldata already ends
 * with a Schema 0 tag, merge codes (existing first, deduped) instead of
 * double-tagging — indexers read only the last tag, so two suffixes would
 * lose one. A Schema 2 (role-based) tag is left untouched.
 */
export function tagCalldata(data, code) {
  const suffix = toDataSuffix(code);
  const base = typeof data === 'string' && data.length >= 2 ? data : '0x';
  const existing = fromDataSuffix(base);
  if (!existing) return base + suffix.slice(2);
  if (existing.schemaId !== 0) return base; // Schema 2: do not rewrite
  const ours = validateCodes(code);
  const merged = [...existing.codes];
  for (const c of ours) if (!merged.includes(c)) merged.push(c);
  // Strip the old suffix: codes + len byte + schema byte + 16-byte marker.
  const oldBytes = existing.codes.join(',').length + 1 + 1 + 16;
  const stripped = base.slice(0, base.length - oldBytes * 2);
  return stripped + toDataSuffix(merged).slice(2);
}

// ---------------------------------------------------------------------------
// Code derivation (celo-org/attribution-tags, byte-identical)
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';

function sha256First12Hex(normalized) {
  return createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 12);
}

/**
 * Derive the builder code for a GitHub repo slug ("owner/repo" or full URL).
 * This is the code the Celo Builders platform derives at registration; the
 * agent asserts at startup that its configured code matches this derivation.
 */
export function codeFromRepo(repo) {
  if (typeof repo !== 'string' || repo.trim().length === 0) {
    throw new Error('codeFromRepo: repository slug is required');
  }
  const trimmed = repo.trim();
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)/i.exec(trimmed);
  const slug = m ? `${m[1]}/${m[2].replace(/\.git$/i, '')}` : trimmed;
  const normalized = slug.toLowerCase();
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(normalized)) {
    throw new Error(`codeFromRepo: expected "owner/repo" or a github.com URL, got ${JSON.stringify(repo)}`);
  }
  return `celo_${sha256First12Hex(normalized)}`;
}

/** Derive a code from a hostname (MiniPay flow): lowercase, strip leading www. */
export function codeFromHostname(hostname) {
  if (typeof hostname !== 'string' || hostname.length === 0) {
    throw new Error('codeFromHostname: hostname is required');
  }
  let normalized = hostname.toLowerCase();
  if (normalized.startsWith('www.')) normalized = normalized.slice(4);
  if (!/^[a-z0-9.-]+$/.test(normalized)) {
    throw new Error(`codeFromHostname: invalid hostname ${JSON.stringify(hostname)}`);
  }
  return `celo_${sha256First12Hex(normalized)}`;
}

// ---------------------------------------------------------------------------
// Addresses & amounts
// ---------------------------------------------------------------------------

export function isAddress(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function assertAddress(value, label) {
  if (!isAddress(value)) throw new Error(`${label}: not a valid EVM address: ${String(value)}`);
  return value;
}

/**
 * Parse a human decimal string into atomic units.
 * Rejects more fractional digits than the token allows, negatives, and junk.
 */
export function parseDecimalToAtomic(amount, decimals, label) {
  if (typeof amount !== 'string' || !/^\d+(\.\d+)?$/.test(amount.trim())) {
    throw new Error(`${label}: invalid decimal amount ${JSON.stringify(amount)}`);
  }
  const [whole, frac = ''] = amount.trim().split('.');
  if (frac.length > decimals) {
    throw new Error(`${label}: ${amount} has more than ${decimals} decimal places`);
  }
  const atomic = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
  if (atomic <= 0n) throw new Error(`${label}: amount must be > 0 (got ${amount})`);
  return atomic;
}

export const parseUsdtAmount = (amount) => parseDecimalToAtomic(amount, 6, 'USD₮ amount');
export const parseIdrxAmount = (amount) => parseDecimalToAtomic(amount, 2, 'IDRX amount');

/** Format atomic units back to a human decimal string (no trailing zeros lost). */
export function formatAtomic(atomic, decimals) {
  const v = BigInt(atomic);
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

// ---------------------------------------------------------------------------
// Textile RFQ API v2 — response parsing
// ---------------------------------------------------------------------------

export const TEXTILE_API_BASE = 'https://api.textilecredit.com/v2';
export const CELO_CHAIN_ID = 42220;
/** Taker fee on Celo: 2 bps = 0.02%. */
export const TAKER_FEE_BPS = 2n;
/** Mainnet dollar floor per the RFQ docs (default $1 of notional). */
export const MAINNET_MIN_NOTIONAL_USD = 1;

/** Protocol fee for a sell size, in the sell token's atomic units (2 bps). */
export function takerFee(sellAtomic) {
  return (BigInt(sellAtomic) * TAKER_FEE_BPS) / 10000n;
}

/**
 * Minimum-size gate for a mainnet exact-input request.
 * sellAtomic is in the sell token's atomic units; sellDecimals + a USD price
 * of ~$1 per USD₮ (stablecoin) give the notional. Returns { ok, notionalUsd, reason? }.
 * NOTE: the docs state the floor as a *dollar* floor (default $1); a corridor
 * can set a different floor, and the live API is authoritative — a 400 or
 * no_quote from /rfq/request outranks this local check.
 */
export function checkMinNotional({ sellAtomic, sellDecimals = 6, usdPrice = 1 }) {
  const notionalUsd = Number(BigInt(sellAtomic)) / 10 ** sellDecimals * usdPrice;
  if (notionalUsd < MAINNET_MIN_NOTIONAL_USD) {
    return {
      ok: false,
      notionalUsd,
      reason: `below_minimum: notional $${notionalUsd.toFixed(2)} < $${MAINNET_MIN_NOTIONAL_USD} mainnet dollar floor (Textile RFQ docs)`,
    };
  }
  return { ok: true, notionalUsd };
}

const NO_QUOTE_REASONS = new Set(['no_makers_online', 'no_restricted_liquidity', 'no_valid_quote']);

/**
 * Normalize a parsed JSON body from POST /v2/rfq/preview or /v2/rfq/request.
 * Returns a discriminated object; never throws on API-shaped input.
 * Throws only when the body is not an RFQ-shaped object at all.
 */
export function parseQuoteResponse(body) {
  if (!body || typeof body !== 'object' || !body.data || typeof body.data !== 'object') {
    throw new Error('parseQuoteResponse: response has no data object');
  }
  const d = body.data;
  if (d.status === 'preview') {
    return {
      kind: 'preview',
      sellAmount: d.sellAmount ?? null,
      buyAmount: d.buyAmount ?? null,
      feeAmount: d.feeAmount ?? null,
      takerPays: d.takerPays ?? null,
      rateRay: d.rateRay ?? null,
      availableSellAmount: d.availableSellAmount ?? null,
    };
  }
  if (d.status === 'no_quote') {
    if (d.reason && !NO_QUOTE_REASONS.has(d.reason)) {
      // Unknown reason string — keep it, but flag it so the caller can see it.
      return { kind: 'no_quote', reason: d.reason, unknownReason: true, availableSellAmount: d.availableSellAmount ?? null, reservedUntil: d.reservedUntil ?? null, retryAfterMs: d.retryAfterMs ?? null };
    }
    return {
      kind: 'no_quote',
      reason: d.reason ?? 'no_valid_quote',
      availableSellAmount: d.availableSellAmount ?? null,
      reservedUntil: d.reservedUntil ?? null,
      retryAfterMs: d.retryAfterMs ?? null,
    };
  }
  if (d.status === 'quoted') {
    const q = d.quote ?? {};
    for (const f of ['sellAmount', 'buyAmount', 'feeAmount', 'takerPays', 'rateRay', 'expiresAt', 'reactor', 'encodedOrder', 'signature']) {
      if (q[f] === undefined || q[f] === null) throw new Error(`parseQuoteResponse: quoted response missing quote.${f}`);
    }
    if (!d.transactions?.swap?.to || !d.transactions?.swap?.data) {
      throw new Error('parseQuoteResponse: quoted response missing transactions.swap.{to,data}');
    }
    return {
      kind: 'quoted',
      rfqId: d.rfqId,
      claimToken: d.claimToken ?? null,
      quote: {
        sellAmount: q.sellAmount,
        buyAmount: q.buyAmount,
        feeAmount: q.feeAmount,
        takerPays: q.takerPays,
        rateRay: q.rateRay,
        expiresAt: q.expiresAt,
        orderDeadline: q.orderDeadline ?? null,
        reactor: q.reactor,
        taker: q.taker ?? null,
        encodedOrder: q.encodedOrder,
        signature: q.signature,
        orders: q.orders ?? [],
      },
      transactions: {
        approval: d.transactions.approval ?? null,
        swap: { to: d.transactions.swap.to, data: d.transactions.swap.data, value: d.transactions.swap.value ?? '0' },
      },
    };
  }
  throw new Error(`parseQuoteResponse: unknown status ${JSON.stringify(d.status)}`);
}

/** Parse an error body from the RFQ API (401 proof_of_control_required etc.). */
export function parseApiError(status, body) {
  const reason = body?.error?.details?.reason ?? body?.error?.message ?? body?.message ?? `HTTP ${status}`;
  return { status, reason, raw: body ?? null };
}

/** True when the error means "sign a takerProof and retry". */
export function isProofRequiredError(parsed) {
  return parsed.status === 401 && parsed.reason === 'proof_of_control_required';
}

// ---------------------------------------------------------------------------
// Payout validation
// ---------------------------------------------------------------------------

/**
 * Validate one payout run's parameters before any network or signing happens.
 * Returns a normalized plan object. Throws on the first problem.
 */
export function validatePayoutPlan({ sellAmountUsdt, taker, recipient, idrxBalance = null }) {
  const sellAtomic = parseUsdtAmount(sellAmountUsdt);
  assertAddress(taker, 'taker');
  assertAddress(recipient, 'recipient');
  if (taker.toLowerCase() === recipient.toLowerCase()) {
    throw new Error('validatePayoutPlan: recipient must differ from the taker wallet (no self-payout)');
  }
  const min = checkMinNotional({ sellAtomic, sellDecimals: 6 });
  return {
    sellAmountUsdt,
    sellAtomic: sellAtomic.toString(),
    taker,
    recipient,
    minNotional: min,
    idrxBalance: idrxBalance === null ? null : idrxBalance.toString(),
  };
}
