# IDRX Payout Agent

An agent that receives **USD₮**, converts it to **IDRX** (Indonesian rupiah
stablecoin) on **Textile FX**, and pays the IDRX out to a named recipient  - 
all on **Celo mainnet** (chain 42220), with an **ERC-8021 attribution tag**
on every transaction and an **ERC-8004** on-chain identity.

Built for the Celo **"Agents Open for Business"** hackathon (Loops House),
track **Stablecoin Corridors**. Submission deadline: **7 Dec 2026, 09:00 GMT
(16:00 WIB)**.

## Live demo

**https://belski21-growl.github.io/idrx-payout-agent/** - live on-chain status
(latest block, ERC-8004 agent ID 10131, work-wallet balances, recipient
balance), the proven-live evidence (registration tx, both CELO→USD₮ swaps,
the $1.00 Textile floor test), and the try-it-yourself commands. No wallet
connection, no signature - the page only reads public chain state.

AskBots review round 1 (27 Nov 2026): **6.4/10** - the only next step was
this live demo URL. Review round 2 is 4 Dec.

## What it does

```
USD₮ (work wallet) ──Textile FX RFQ──▶ IDRX ──transfer──▶ recipient
  0x8F3E…83AA                              0xAC9B…1aF8 (outside the team)
```

1. Check USD₮ / CELO / IDRX balances (public RPC read).
2. Preview a Textile RFQ quote for USD₮ → IDRX (free, no key, no signature).
3. Request a firm quote - keyless, with a free EIP-712 "Textile Taker
   Control" proof signed by the work wallet (valid ~12 h once verified).
4. Approve USD₮ to the Textile reactor (once, only the shortfall; USDT-style
   reset-to-zero first when a non-zero allowance exists).
5. Submit the swap - broadcasts `transactions.swap` exactly as returned,
   after re-checking the quote's `expiresAt`.
6. Transfer **all** IDRX received to the named recipient.
7. Write an evidence JSON file (`evidence/<timestamp>-<kind>.json`) with the
   quote, tx hashes, blocks, amounts, and fees.

## Attribution tag (ERC-8021)

Every transaction this agent sends carries a Schema 0 attribution suffix:
code **`celo_41b8d909dcde`** (derived from this repo slug via `codeFromRepo`,
verified against `@celo/attribution-tags`). Loops House issued code
`celo_e94fe5d67772` at enrollment - set `LOOPS_ATTRIBUTION_CODE` and the agent
tags with **both** codes; the program only credits its assigned code.

Suffix: `0x63656c6f5f343162386439303964636465110080218021802180218021802180218021`

Details + sources: [`docs/registration-checklist.md`](docs/registration-checklist.md).

## Quick start

```bash
npm install
npm test                                   # unit tests (offline, no key)
node agent/idrx-payout-agent.mjs --dry-run # preview quote + plan, sends nothing
```

Live run (coordinator/parent only - sends real mainnet transactions):

```bash
CELO_WORK_KEY=0x... node agent/idrx-payout-agent.mjs --amount 1.00
# add --yes to skip the interactive confirmation
# add --recipient 0x... to override the payout recipient
```

ERC-8004 registration (coordinator/parent only):

```bash
# 1. Publish agent/registration.json at a public URL first.
# 2. Dry-run the calldata:
node agent/register-8004.mjs --dry-run --uri https://<host>/registration.json
# 3. Live (1 tx, tagged):
CELO_WORK_KEY=0x... node agent/register-8004.mjs --uri https://<host>/registration.json
# 4. The agent ID is printed from the Registered event. Add it to
#    registration.json under "registrations", re-publish, then:
CELO_WORK_KEY=0x... node agent/register-8004.mjs --set-uri <agentId> --uri https://<host>/registration.json
```

### Environment variables

| Variable | Required | Notes |
|---|---|---|
| `CELO_WORK_KEY` | live runs only | 0x-prefixed 64-hex private key of the work wallet. Env var only - never a file, never committed. Without it, live runs exit with "CELO_WORK_KEY belum di-set". |
| `CELO_RPC_URL` | no | Default `https://forno.celo.org`. |
| `LOOPS_ATTRIBUTION_CODE` | no | Code issued by Loops House at enrollment; tagged alongside the repo code. |
| `TEXTILE_API_KEY` | no | Partner key; when set, no `takerProof` signature is needed. |

## Minimum swap - read this first ⚠️

Textile's RFQ docs state the mainnet minimum is the corridor's **dollar
floor, default $1 of notional**. The default run size is **0.10 USD₮**
(one faucet claim = $0.10), which is **below the published floor**.

What that means in practice:
- The preview/firm request for 0.10 USD₮ will very likely come back
  `400` (below minimum) or `no_quote`. The agent handles both cleanly:
  it writes an evidence file, sends nothing, and exits.
- **Settled by a live test 25 Nov 2026 ~23:02: the floor is $1.00.** A firm
  request for 0.10 USD₮ came back HTTP 400 - “sellAmount is below the RFQ
  minimum (1000000 atomic units)”. The preview of the same size passes
  (preview does not enforce the floor), so a size that previews fine can
  still be refused at firm-request time.
- To reach $1 with faucet claims alone takes **10 × 0.10 USD₮ claims**
  (first come, first served, until 7 Dec). Plan the live test at
  `--amount 1.00` (or the size the preview accepts) once the wallet
  holds ≥ $1 of USD₮.
- The $1.00 floor was met and the payout is done: the $1.00 payout ran on 27 Nov 2026 and delivered 18,439.70 IDRX to the recipient (see the track requirements table).

## Cost estimate (per live run, Celo mainnet)

Celo gas is cheap; the numbers below are gas-unit estimates - the exact
gas used is recorded per transaction in the evidence file. At Celo's
typical ~0.1 gwei gas price, 1,000,000 gas ≈ 0.0001 CELO.

| Step | Est. gas | Notes |
|---|---|---|
| ERC-20 `approve` (USD₮ → reactor) | ~45,000 | Once; skipped if allowance already covers `takerPays`. +~45,000 if a reset-to-zero is needed first. |
| Textile swap (`execute`/`executeBatch`) | ~200,000-400,000 | One tx; batch quotes (split across makers) cost more. |
| IDRX `transfer` (payout) | ~50,000 | One tx, full IDRX balance to the recipient. |
| ERC-8004 `register()` | ~150,000 | One tx, one-time. |
| ERC-8004 `setAgentURI()` | ~50,000 | One tx, one-time, after the ID is known. |
| Textile RFQ preview / firm quote | 0 (off-chain) | HTTP only. |
| "Proof of Funds" / TakerControl signature | 0 (off-chain) | Free EIP-712 signature, moves no funds. |

Textile taker fee on Celo: **2 bps** (0.02%) of the sell size, taken in
the sell token and already inside `takerPays` (e.g. 0.0002 USD₮ on a
1.00 USD₮ swap). Total expected on-chain cost for one full payout run:
well under 0.001 CELO at 0.1 gwei - covered many times over by the
0.25 CELO faucet claim.

## Evidence

Every run writes `evidence/<ISO-timestamp>-<kind>.json`:
- `dry-run` / `preview-no-quote` / `firm-no-quote` / `firm-400` /
  `aborted` - stopped before any transaction; quote (or refusal) included.
- `completed` - full run: quote (`rfqId`, `buyAmount`, `feeAmount`,
  `takerPays`, `rateRay`, `expiresAt`), approval / swap / payout tx
  hashes + block numbers + gas used, IDRX received and paid out,
  attribution codes + suffix.

## Track requirements - status

| Requirement | Status | Notes |
|---|---|---|
| ≥1 tagged Textile FX conversion on Celo mainnet in a listed corridor, used in the product flow | ✅ DONE - 27 Nov 2026 | USD₮→IDRX is a listed Celo corridor. Firm quote `rfq_8MOq_ogcAwK_gQMy`: 1.00 USD₮ to 18,439.70 IDRX. Swap tx `0x6413cd83…`, block 83889434, success. |
| Payment in a local stablecoin reaches a recipient outside the team | ✅ DONE - 27 Nov 2026 | Recipient `0xAC9B…1aF8` is outside the team. Transfer tx `0xf9f01ba3…`, block 83889462, success, 18,439.70 IDRX. |
| ERC-8004 identity | ✅ DONE - agent ID **10131** | Registered 25 Nov 2026, tx `0x4fc5e5e4…`, block 83720943; `ownerOf(10131)` = work wallet, `tokenURI` = registration.json. |
| Attribution tag in every transaction | ✅ READY | ERC-8021 Schema 0 suffix on every tx the agent sends; pure encoder cross-checked against the official SDK each run. Loops-issued code still to be added after enrollment. |
| Not arbitrage / self-trading / maker | ✅ BY DESIGN | One-way payout flow: USD₮ in from a client, IDRX out to a third-party recipient. No limit orders, no maker activity. |
| Public GitHub repo at registration | ✅ READY | https://github.com/belski21-growl/idrx-payout-agent |
| Code written 20 Nov - 7 Dec 2026 | ✅ | Fresh code, written 25 Nov 2026 for this hackathon. No AgentProof code reused. |
| Loops House registration (before 4 Dec for AskBots review round 2) | ✅ DONE 25 Nov 2026 | Enrolled as “Belski Raizo” (Bandar Lampung, Indonesia); attribution code `celo_e94fe5d67772` issued; work wallet on file. AskBots round 1 review received 27 Nov (6.4/10). |
| Faucet claims (CELO 0.25, USD₮ 0.10) | ❌ FAUCET BROKEN - funded another way | Claim API returns HTTP 500: the faucet relayer wallet holds ~0.048 CELO but needs 6.075 CELO. User funded the work wallet directly instead (6.53 CELO, 25 Nov). |

## Project layout

```
agent/
  idrx-payout-agent.mjs   main agent: quote → approve → swap → payout → evidence
  register-8004.mjs       ERC-8004 register + setAgentURI (live runs need approval)
  registration.json       ERC-8004 agentURI file (agent ID 10131 recorded 25 Nov)
  lib/
    pure.mjs              dependency-free pure logic (tag codec, quote parsing, validation)
    config.mjs            public addresses + constants (no secrets)
  test/
    pure.test.mjs         unit tests - node --test (offline, no key)
docs/
  registration-checklist.md   research: attribution tags, Textile RFQ API v2,
                              ERC-8004, Loops House form fields
evidence/                 run evidence JSON files (created by live/dry runs)
```

## Safety rules (hard)

- The wallet key is accepted **only** via the `CELO_WORK_KEY` env var.
  No key files are read, no wallet is created, no key is ever logged or
  committed (`.gitignore` covers `.env`, `*.key`, `*.pem`).
- The agent refuses to run live without a key, and refuses a key that
  does not belong to the configured work wallet.
- `--dry-run` needs no key and sends nothing.
- No transaction is sent by this builder. All on-chain execution is the
  coordinator/parent's (Agent L's) decision.
- Amounts: USD₮ has 6 decimals, IDRX has 2 - all parsing/formatting
  goes through one module (`agent/lib/pure.mjs`) with unit tests.
