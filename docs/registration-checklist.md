# Registration checklist — research notes (read-only, 25 Nov 2026)

All facts below were read from the official public docs on 25 Nov 2026.
Nothing here was submitted, registered, or claimed anywhere.

## 1. ERC-8021 attribution tag (celo-org/attribution-tags)

Source: https://github.com/celo-org/attribution-tags (README + BUILDERS.md + `sdk/src/index.ts`)

### What it is
A short suffix appended to the END of a transaction's calldata. The EVM
discards trailing bytes, so it never changes execution semantics — it only
makes the transaction identifiable as having come through your app.
Standard: ERC-8021, Schema 0 (canonical registry) is the Celo default.

### Wire format (Schema 0) — verified against the `ox` source
```
ascii(codes.join(',')) || len(1 byte) || schemaId 0x00 || marker(16 bytes)
marker = 0x80218021802180218021802180218021
```
Published `ox` vector (used as a pinned test):
`toDataSuffix(['baseapp','morpho'])`
= `0x626173656170702c6d6f7270686f0e0080218021802180218021802180218021`

### Do you have to register a tag first?
**No — tagging is open to everyone.** There is no form and no key.
You can tag with any code matching `[a-z0-9_]{1,32}` and the transaction
will carry it on-chain.

**But: getting CREDITED is a registry-layer step, not a tagging step.**
- A code you self-derive (e.g. from your hostname or repo) tags correctly
  but is *silently never credited* by a program that assigned you a
  different code.
- Hackathons / cohort programs assign your code at registration — "often
  derived from something other than your hostname, such as your GitHub
  repository". Leaderboards and reward programs only credit the assigned
  code.
- A suffix can carry MULTIPLE codes, so the fix is to tag with both:
  `toDataSuffix(['your_own_code', 'celo_assigned1234'])`.

### This project's tag value
- Repo-derived code (via `codeFromRepo`, byte-identical to the Celo
  Builders platform derivation: trim → lowercase → SHA-256 → first 6
  bytes → `celo_` prefix):
  **`celo_41b8d909dcde`** for `belski21-growl/idrx-payout-agent`
  (verified live against `@celo/attribution-tags` on 25 Nov 2026).
- Its suffix: `0x63656c6f5f343162386439303964636465110080218021802180218021802180218021`
- **Loops House issued code: NOT YET KNOWN.** Evidence from another
  entrant's public repo (dunoil/tanda): "the Loops House attribution tag
  for this entry, issued at enrollment: Code: celo_f58da6359b7f". So the
  code is issued when you enroll/register on Loops House. Action: after
  registration, copy the issued code into `LOOPS_ATTRIBUTION_CODE` (env)
  — the agent then tags every tx with BOTH codes.
- Before the first tagged tx, verify with `verifyTx` that the on-chain
  codes include the assigned one (BUILDERS.md: "This one check catches
  the missing-assigned-code mistake").

### How it is attached (in this repo)
- Official SDK `@celo/attribution-tags` (`toDataSuffix`) is a runtime
  dependency; `agent/lib/pure.mjs` contains a dependency-free encoder
  that is cross-checked against the SDK on every run (mismatch = refuse
  to send).
- The agent appends the suffix to the calldata of EVERY tx it sends:
  approval, swap (`transactions.swap.data` from Textile — keyless callers
  get no Textile tag, so ours is the only one; do NOT append a second
  suffix if `includeAttribution` was ever enabled), IDRX payout transfer,
  and the ERC-8004 `register()` / `setAgentURI()` txs.
- Layering rule respected: we only add OUR codes, never platform codes
  like `minipay` / `proofofship`.

## 2. Textile FX — RFQ API v2

Source: https://fx-docs.textilecredit.com (home, `/api/v2/rfq.html`, `/api/v2/authentication.html`)

### Base URL
`https://api.textilecredit.com/v2`

### Endpoints (5 calls)
| Call | Method / path | Notes |
|---|---|---|
| Preview a price | `POST /v2/rfq/preview` | Free estimate, no `taker`, no signature, no RFQ slot. Same body as request minus `taker`. Status `preview` or `no_quote`. |
| Request a firm quote | `POST /v2/rfq/request` | **Blocks** while makers answer (reply budget 750 ms default, up to 10 s; worst-case hold ~70 s incl. decimals preflight → client timeout **75 s**). |
| Release a quote | `POST /v2/rfq/{id}/cancel` | Only while `quoted`; needs `X-Rfq-Claim` header or the requesting API key. |
| Report the transaction | `POST /v2/rfq/{id}/submit` | Body `{ "txHash": "0x…" }`. Idempotent per hash; courtesy only — fills are reconciled on-chain. |
| Read the status | `GET /v2/rfq/{id}` | Statuses: `soliciting`, `quoted`, `no_quote`, `submitted`, `filled`, `failed`, `expired`. |

### Request body (firm quote, exact-input)
```json
{
  "chainId": 42220,
  "sellToken": "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
  "buyToken": "0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22",
  "sellAmount": "100000",
  "taker": "0x8F3E972f8006aE76D55385cF9Df8bF86160983AA",
  "takerProof": { "nonce": "0x…32 random bytes…", "issuedAt": 1756400000000, "signature": "0x…" }
}
```
- Send exactly ONE of `sellAmount` (exact-input) or `buyAmount` (exact-output).
- `sellAmount` is the **gross, fee-inclusive spend cap**; read `takerPays`
  for the exact debit. Approve `takerPays`.
- **Minimum size: the corridor's dollar floor, default $1 of notional in
  the named token** on mainnet (about $0.01 on testnets). Below that is a
  `400`. → 0.10 USD₮ ($0.10) is **below the published floor**.
  See README § "Minimum swap" for the consequences and the live-test plan.

### Firm-quote response (quoted)
```json
{
  "data": {
    "rfqId": "rfq_…",
    "claimToken": "rfqc_…",
    "status": "quoted",
    "quote": {
      "sellAmount": "1000000000", "buyAmount": "612000000",
      "feeAmount": "99990", "takerPays": "1000000000",
      "rateRay": "612000000000000000000000000",
      "expiresAt": "2026-08-19T12:00:27.000Z",
      "orderDeadline": "2026-08-19T12:00:30.000Z",
      "latestOrderDeadline": "2026-08-19T12:00:30.000Z",
      "reactor": "0xReactor", "taker": "0xYourWallet",
      "encodedOrder": "0x…", "signature": "0x…",
      "orders": [ { "encodedOrder": "0x…", "signature": "0x…", "sellAmount": "…", "buyAmount": "…", "feeAmount": "…", "maker": "0xMaker" } ]
    },
    "transactions": {
      "approval": { "to": "0xCNGN", "data": "0x095ea7b3…", "value": "0", "chainId": 56 },
      "swap":     { "to": "0xReactor", "data": "0x…", "value": "0", "chainId": 56 }
    }
  }
}
```
- **Always broadcast `transactions.swap`** (an `executeBatch` when the
  quote is split across makers). The top-level `encodedOrder`/`signature`
  are only the first order — executing those under-fills.
- `expiresAt` is the accept cutoff; re-check the clock before
  broadcasting. `orderDeadline` is when the signed order stops settling.
- A `no_quote` is a **200**, not an error. Reasons: `no_makers_online`,
  `no_restricted_liquidity`, `no_valid_quote`. `availableSellAmount` is
  the published depth on the named leg (retry at that size if you asked
  for more). `reservedUntil` / `retryAfterMs` appear when another live
  quote is holding the liquidity.
- `encodedOrder` / `signature` / `claimToken` are returned exactly once —
  `GET /v2/rfq/{id}` never replays them. Store the claim token; it
  authorizes cancel / submit / status for that RFQ (`X-Rfq-Claim` header,
  or the requesting API key).
- Taker fee on Celo: **2 bps** (0.02%), inside `takerPays`.

### Proof of control (keyless callers only)
- First firm request carries `takerProof`: a signature **by the taker
  wallet** over a short-lived challenge. With a partner API key
  (`Authorization: Bearer <key>`) you NEVER sign it — leave it out.
- EIP-712 default ("Textile Taker Control" v1):
  - domain `{ name: "Textile Taker Control", version: "1", chainId }`
  - type `TakerControl { taker: address, chainId: uint256, nonce: bytes32, issuedAt: uint256 }`
  - `issuedAt` = Unix **milliseconds**, must be within 60 s of Textile's clock.
- "Proof of Funds" v2 (what the app shows) is also accepted:
  domain `{ name: "Textile Proof of Funds", version: "2", chainId }`,
  type `ProofOfFunds { purpose: string, wallet: address, chainId: uint256, nonce: bytes32, issuedAt: uint256 }`,
  purpose = `"Proves you control this wallet and its funds. Moves no funds and approves no transfer, trade or allowance."`
- Pattern: send the request unsigned first; on `401
  proof_of_control_required`, sign and resend. One verified proof covers
  that wallet + chain for **~12 hours** (grant bound to the caller).
- The proof is free and moves no funds; it only proves control + the
  wallet holds the sell token (proof of funds check on every request).

### Attribution on Textile swaps
- Opt-in, partner keys only: `includeAttribution: true` (+ optional
  `builderCodes: ["bc_yourcode"]`, max 3, `[a-z0-9_]{1,32}`, codes
  starting `textile_` / `tp_` are reserved → 400) makes
  `transactions.swap.data` end with an ERC-8021 tag carrying
  `textile_api` + your code. `builderCodes` alone does NOT enable it.
- Keyless/wallet callers: no tag from Textile — **append your own suffix
  to `transactions.swap.data` before sending** (this is what this agent
  does). Never append a second suffix: indexers read only the last tag.
- The approval calldata is plain `approve`, no tag (we tag it ourselves).

### Swap execution rules (from the docs)
1. Approve `takerPays` to `quote.reactor`; skip if allowance covers it.
   USDT-style tokens reject approve(non-zero → non-zero): reset to 0 first.
2. Wait for the approval receipt BEFORE broadcasting the swap (the
   reactor pulls the sell token inside `executeBatch`; same-block
   broadcast risks the swap landing first and reverting).
3. `value` is always `"0"`; the fee is taken in the sell token.

## 3. ERC-8004 registration

Source: https://docs.celo.org/build-on-celo/build-with-ai/8004

- Identity Registry (Celo mainnet): `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- Reputation Registry (Celo mainnet): `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`
- `register(agentURI)` — 1 tx; sets the agent wallet to the sender.
  Agent ID is an ERC-721 token ID.
- `setAgentURI(agentId, newURI)` — point the registry at an updated file.
- **Agent ID is read from the `Registered` event on the receipt** — the
  value `register()` returns is `_lastId` at simulation time, so anyone
  else registering first makes it wrong.
- Registration file: JSON hosted anywhere (HTTPS URL, IPFS, `data:` URI).
  Order: publish WITHOUT `registrations` → register → update the file
  WITH the ID → `setAgentURI` to the new file (for IPFS/`data:` the URI
  changes when the content changes).
- File lives in this repo at `agent/registration.json` (template, no
  agent ID yet). Script: `agent/register-8004.mjs` (NOT executed yet).
- Verify afterwards at https://8004scan.io.
- Self Agent ID is recommended but NOT required for this track.

## 4. Loops House registration form — fields

Source: https://www.loops.house/agents-open-for-business (public page,
fetched 25 Nov 2026) + Loops House patterns from other hackathons.

### ⚠️ Exact field list: NOT extractable from the public page
The public hackathon page shows the rules, tracks, timeline, prizes and
FAQ, but **no registration form is visible in the fetched page text** —
the form lives behind the Loops House "Register" flow (account/login),
which a read-only fetch cannot open. The browser task must open the
Register button on the page and record the literal fields. Do NOT guess
the form from memory.

### What the public page DOES state is required at registration/submission
(from the Rules + FAQ + track Requirements sections, verbatim substance):
1. **Public GitHub repo** — "Public GitHub repo at registration that
   still resolves at judging." → this repo:
   `https://github.com/belski21-growl/idrx-payout-agent`
2. **Attribution tag code, issued at enrollment** — the tag is assigned
   when you register (see §1 above; another entrant's repo shows
   `celo_f58da6359b7f` "issued at enrollment"). The form (or a
   confirmation step) is where the issued code appears — **capture it**.
3. **Payout wallet address** — "Prizes are set in USD and paid in CELO
   at the USD equivalent to the payout wallet you register."
   → work wallet `0x8F3E972f8006aE76D55385cF9Df8bF86160983AA`
   (confirm whether this means the agent work wallet or a separate
   payout wallet — record the form's exact label).
4. **PayTo address** — only for x402 sellers ("x402 sellers also
   register their PayTo address"). Not applicable to this track unless
   the form asks anyway.
5. **ERC-8004 agent ID** — every entry registers its agent on ERC-8004
   (required). The form may ask for the agent ID / registry link —
   record whether it is asked at registration or only at submission.
6. **Track selection** — Stablecoin Corridors (this entry enters that
   track only).
7. **Follow @Celo and @CeloDevs on X** (a stated rule — likely a
   checkbox/attestation, not a form field).

### Fields seen on OTHER Loops House hackathons (inferred — verify live)
From the IPFS × OpenClaw Loops page FAQ: "a project title, short pitch,
detailed description, and links to your repo/demo" + team up to 4
members. From the NEAR Loops page: "the repository link, the demo post
link and the NEAR wallet address prizes should go to". Treat these as a
packing list to PREPARE, not as the confirmed field list for this
hackathon:
- Project title: **IDRX Payout Agent**
- Short pitch: USD₮ in → Textile FX → IDRX out to a named recipient on Celo.
- Detailed description: see README.
- Repo link: https://github.com/belski21-growl/idrx-payout-agent
- Demo link: (to be recorded — video/screenshots after the live run)
- Payout wallet: `0x8F3E972f8006aE76D55385cF9Df8bF86160983AA`
- Team: Belski Raizo (solo; confirm whether the form wants a team size)

### Deadlines (from the page)
- Registration ends: **7 Dec 2026** (Mon 7 Dec, 09:00 GMT = 16:00 WIB).
- Submissions close: same moment.
- AskBots review round 2: **Fri 4 Dec** — register BEFORE 4 Dec to get
  the review (posted as GitHub issues on the repo).
- Winners announced: Fri 11 Dec. Prizes paid in CELO.

### Faucets (from the page FAQ — browser/parent path, NOT claimed here)
- CELO: app.faucetdrops.io/faucet/celo-agentic-hackathons-celo-3585,
  code `PM2M4C`, 0.25 CELO per claim.
- USD₮: app.faucetdrops.io/faucet/celo-agentic-hackathons-usdt-c654,
  code `QXO4ND` (3rd character is the letter O), 0.10 USD₮ per claim.
- Both open until 7 Dec, first come first served.
