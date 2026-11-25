/**
 * config.mjs — All network / token / track constants for the IDRX Payout Agent.
 * Public addresses only. No secrets here — the wallet key comes from the
 * CELO_WORK_KEY environment variable and is never stored in this repo.
 */

export const CHAIN_ID = 42220; // Celo mainnet
export const RPC_URL = process.env.CELO_RPC_URL ?? 'https://forno.celo.org';

export const TOKENS = {
  /** USD₮ on Celo mainnet, 6 decimals. */
  USDT: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
  /** IDRX (rupiah stablecoin) on Celo mainnet, 2 decimals. */
  IDRX: '0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22',
};

/** Textile LimitOrderReactor on Celo mainnet (receives the swap + the approval). */
export const TEXTILE_REACTOR = '0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3';

/** ERC-8004 Identity Registry on Celo mainnet. */
export const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

/** Agent work wallet (address only — the key is supplied via CELO_WORK_KEY). */
export const WORK_WALLET = '0x8F3E972f8006aE76D55385cF9Df8bF86160983AA';

/** Named recipient of the IDRX payout — outside the team (a real payout). */
export const RECIPIENT = '0xAC9BD03F89C71A028107809432F27CbE16DF1aF8';

/** GitHub repo slug of this project (drives the attribution code). */
export const REPO_SLUG = 'belski21-growl/idrx-payout-agent';

/**
 * Attribution code for this project, derived from the repo slug
 * (codeFromRepo: trim -> lowercase -> SHA-256 -> first 6 bytes -> "celo_").
 * Verified against @celo/attribution-tags codeFromRepo().
 *
 * IMPORTANT: Loops House issues an attribution code at enrollment
 * (see docs/registration-checklist.md). If the code issued at registration
 * differs from this one, set LOOPS_ATTRIBUTION_CODE to the issued code —
 * the agent tags with BOTH codes (the program only credits its assigned
 * code; a self-derived code alone is silently never credited).
 */
export const ATTRIBUTION_CODE = 'celo_41b8d909dcde';

/** Default exact-input size for one payout run (0.10 USD₮ = one faucet claim). */
export const DEFAULT_SELL_USDT = '0.10';

/** Textile RFQ API v2 base URL. */
export const TEXTILE_API_BASE = 'https://api.textilecredit.com/v2';

/** Where evidence JSON files are written (one file per run). */
export const EVIDENCE_DIR = new URL('../../evidence/', import.meta.url).pathname;
