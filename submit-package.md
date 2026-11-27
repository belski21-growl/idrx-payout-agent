# IDRX Payout Agent: Celo "Agents Open for Business" Submission Draft

**Status: DRAFT ONLY. Do not submit. Do not copy into the Loops House form until the owner says so.**
**Hackathon:** Celo "Agents Open for Business" (Loops House)
**Track:** Stablecoin Corridors
**Project:** IDRX Payout Agent
**Deadline:** 7 Dec 2026, 09:00 GMT (16:00 WIB)
**Team:** Belski Raizo (Bandar Lampung, Indonesia)

## One-line pitch

An agent that receives USDt, converts it to IDRX (Indonesian rupiah stablecoin) on Textile FX, and pays the IDRX to a named recipient outside the team, all on Celo mainnet with an ERC-8021 attribution tag on every transaction and an ERC-8004 on-chain identity.

## Problem

Freelancers in Indonesia are often paid in dollar stablecoins, but their daily costs are in rupiah. Converting that pay into local currency usually means leaving the chain, using a centralised off-ramp, paying extra fees, and waiting. There is a live on-chain corridor for exactly this job on Celo (USDt to IDRX), yet there is no simple agent that runs the whole payout end to end: take USDt in, swap it on a decentralised FX venue, and send the local stablecoin straight to the worker who earned it.

## Solution

IDRX Payout Agent is a small Node.js agent that does that one job and proves every step on chain. It previews a Textile FX quote for USDt to IDRX, requests a firm quote, approves only the shortfall, submits the swap exactly as returned, then transfers all IDRX received to the named recipient. Every transaction it sends carries an ERC-8021 attribution tag, and the agent itself is registered on chain under ERC-8004. Each run writes an evidence JSON file with the quote, transaction hashes, blocks, amounts, and fees, so a judge can verify the run without trusting a screenshot.

## How it works

1. Check USDt, CELO, and IDRX balances of the work wallet (public RPC read).
2. Preview a Textile RFQ quote for USDt to IDRX (free, no key, no signature).
3. Request a firm quote, keyless, with a free EIP-712 "Textile Taker Control" proof signed by the work wallet (valid about 12 hours once verified).
4. Approve USDt to the Textile reactor (once, only the shortfall; USDT-style reset-to-zero first when a non-zero allowance exists).
5. Submit the swap, broadcasting `transactions.swap` exactly as returned, after re-checking the quote's `expiresAt`.
6. Transfer all IDRX received to the named recipient (0xAC9B...1aF8, outside the team).
7. Write an evidence JSON file (`evidence/<timestamp>-<kind>.json`) with the quote, transaction hashes, blocks, amounts, and fees.

## Architecture and tech

This project ships no Solidity of its own. It is a Node.js agent built on viem that calls existing audited contracts on Celo mainnet. It does not claim any of those contracts as its own.

| Component | What it is | Address / version |
|---|---|---|
| Agent runtime | Node.js agent (`agent/idrx-payout-agent.mjs`), viem for chain calls | Repo main branch |
| Textile FX | LimitOrderReactor, the swap venue for the USDt to IDRX corridor | `0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3` |
| CELO to USDt swaps | Ubeswap V2 router (used to fund the work wallet with USDt) | `0xE3D8bd6Aed4F159bc8000a9cD47CffDb95F96121` |
| Agent identity | ERC-8004 Identity Registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| USDt (Celo) | Tether USD, 6 decimals | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` |
| IDRX (Celo) | Indonesian rupiah stablecoin, 2 decimals | `0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22` |
| CELO (Celo) | Celo native token as ERC-20 (GoldToken) | `0x471EcE3750Da237f93B8E339c536989b8978a438` |
| Attribution | ERC-8021 Schema 0 suffix on every transaction the agent sends | Codes `celo_41b8d909dcde` (repo-derived) and `celo_e94fe5d67772` (Loops House) |
| Tests | Unit tests, offline, no key | `npm test`: 23 passed, 0 failed |
| Live demo | Static page that reads public chain state only (no wallet, no signing) | https://belski21-growl.github.io/idrx-payout-agent/ |

Notes on the design: the agent refuses to run live without a key, and refuses a key that does not belong to the configured work wallet (0x8F3E...83AA). The key is accepted only through the `CELO_WORK_KEY` environment variable, never from a file and never committed. `--dry-run` needs no key and sends nothing. Textile taker fee on Celo is 2 bps (0.02 percent), already inside the quote. The ERC-8004 registration file is public at `agent/registration.json` in the repo.

## Live evidence

| Item | Evidence |
|---|---|
| Public repo | https://github.com/belski21-growl/idrx-payout-agent |
| Live demo page | https://belski21-growl.github.io/idrx-payout-agent/ |
| ERC-8004 identity | Agent ID 10131, registered 25 Nov 2026. Tx `0x4fc5e5e4a8ee731ed6bcdbea4fe87cafc7c261f990189157d5e45c0a52c28982`, block 83720943. `ownerOf(10131)` = work wallet `0x8F3E972f8006aE76D55385cF9Df8bF86160983AA`. |
| CELO to USDt swap 1 | 2 CELO to 0.103105 USDt, 25 Nov 2026 (Ubeswap V2). Tx `0x5e298f0181c21f9bc597796b88813db86f5fa8464ecd1da9978feb87c1ac3cba`. |
| CELO to USDt swap 2 | 4.25 CELO to 0.213413 USDt, 25 Nov 2026 (Ubeswap V2), block 83721910. Approve tx `0xafa29042f7bc2de683945b683366fec7f2601ffbf2d4d9a6325c58fc5a66032f`. Swap tx `0xb75ff64792c8d9b21a1eef4513c44e7026ce6bc86c5cf605dc8c669ab9d0e458`. |
| Textile dry-run (live, 27 Nov 2026, 21:14 WIB) | Preview sell 0.1 USDt, buy about 1844.08 IDRX, fee 0.000019 USDt. No key, no transaction sent. Evidence file: `evidence/2026-11-27T14-14-54-453Z-dry-run.json`. |
| Funding swap (CELO to USDt, 27 Nov 2026) | 14 CELO to 0.711710 USDt (Ubeswap V2). Tx `0xa3f7fcb6a95be72285e159b3966eb2ebe6b40913cb5237dc5de84628c8770ff1`, block 83889289. Funded by a user top-up of 13 + 3 CELO. |
| $1.00 payout run (live, 27 Nov 2026, 21:37 WIB) | Status completed, finished 2026-11-27T14:37:10Z. Evidence file: `evidence/2026-11-27T14-37-10-555Z-completed.json`. |
| Firm quote | `rfq_8MOq_ogcAwK_gQMy`: pay 1.00 USDt, buy 1,843,970 atomic IDRX (18,439.70 IDRX). Preview before firm: buy 1,844,651 atomic IDRX. The amount received was the firm quote amount. |
| Approve USDt (Textile reactor) | Tx `0xdc628523d91de9e06826d4001af3faef5ec7590f980df7a51d0b27b0ab67c5cf`, block 83889424, status success, gas 53,953. |
| Textile swap (USDt to IDRX) | Tx `0x6413cd8361e2f1c06d09f08663cfb23550020044d9c94fb472bfa18c15fa30c1`, block 83889434, status success, gas 196,493. |
| Transfer IDRX to recipient | Tx `0xf9f01ba3f6c8f867838b25d38c8ebd4e4fdd2ad8872ed7c27a4cf2f61cf7147c`, block 83889462, status success, 18,439.70 IDRX to the recipient (0xAC9B...1aF8, outside the team). |
| Textile floor test (live, 25 Nov 2026) | Firm request for 0.10 USDt rejected HTTP 400: "sellAmount is below the RFQ minimum (1000000 atomic units)", which is $1.00. Evidence file: `evidence/2026-11-25T16-02-20-303Z-firm-400.json`. |
| Unit tests | `npm test`: 23 passed, 0 failed. |
| AskBots review round 1 | 6.4/10, received 27 Nov 2026 (GitHub issue 1 in the repo). Its only next step, a live demo URL, is done: the demo page above is linked from the README and the repo homepage. |
| Work wallet balances (27 Nov 2026, after the payout run) | USDt 0.028228, IDRX 0. Balances before the run: USDt 1.028228, IDRX 0. |
| Recipient balance (27 Nov 2026, after the payout run) | IDRX 18,439.70 at `0xAC9BD03F89C71A028107809432F27CbE16DF1aF8`, verified from the run evidence. |

## Honest notes (read before judging)

1. DONE: the $1.00 payout ran on 27 Nov 2026 at 21:37 WIB and completed. The work wallet held 1.028228 USDt before the run, above the Textile RFQ floor of $1.00, after a user top-up of 13 + 3 CELO and a funding swap of 14 CELO to 0.711710 USDt. The payout paid 1.00 USDt and delivered 18,439.70 IDRX to the recipient. Context, not a blocker: the $1.00 floor was proven live on 25 Nov 2026 (note 2), and the hackathon faucets were broken (note 3), so the wallet was funded directly instead.
2. The $1.00 floor is proven live, not assumed from the docs. A firm request for 0.10 USDt was rejected with HTTP 400 on 25 Nov 2026, while a preview of the same size passes, because the preview does not enforce the floor.
3. The hackathon faucets are broken. Both faucet claims failed with HTTP 500: the faucet relayer wallet held about 0.048 CELO but needed 6.075 CELO, and the USDt faucet balance was only about $0.0052. The work wallet was funded directly instead (6.53 CELO from the owner on 25 Nov 2026). Importing the key into a wallet app would not help, because the faucet UI calls the same broken backend.
4. DONE: the recipient has received 18,439.70 IDRX from the payout run on 27 Nov 2026 (transfer tx in the evidence table, block 83889462). The work wallet IDRX balance after the run is 0, because the payout sends all IDRX received.
5. DONE: the tagged Textile conversion ran on 27 Nov 2026. The two CELO to USDt swaps above are real funding steps on Ubeswap V2, and the funding swap of 14 CELO to 0.711710 USDt on the same day completed the funding. The Textile swap itself (USDt to IDRX, tx in the evidence table, block 83889434) and the IDRX transfer to the recipient are both done.
6. The demo page reads live chain state only. It sends no transaction and asks for no wallet connection.

## Submit checklist

Done:

- [x] Public GitHub repo, code written during the hackathon window (25 Nov 2026, no reused AgentProof code)
- [x] ERC-8004 identity registered on Celo mainnet (agent ID 10131, tx and block in the evidence table)
- [x] ERC-8021 attribution codes on every transaction the agent sends (repo code and Loops House code)
- [x] Loops House enrollment done 25 Nov 2026 (as "Belski Raizo", Bandar Lampung, Indonesia; work wallet on file; code `celo_e94fe5d67772` issued)
- [x] Unit tests: `npm test`, 23 passed, 0 failed
- [x] Live demo page deployed and verified live (GitHub Pages, HTTP 200, values match an independent Forno RPC check)
- [x] AskBots review round 1 received (6.4/10); its only next step (live demo URL) is done, and the fix was replied to in issue 1
- [x] Textile floor ($1.00) proven live; dry-run preview verified live 27 Nov 2026
- [x] Top-up done: user top-up of 13 + 3 CELO, then a funding swap of 14 CELO to 0.711710 USDt on 27 Nov 2026 (tx and block in the evidence table), so the work wallet reached 1.028228 USDt
- [x] $1.00 payout run done 27 Nov 2026, 21:37 WIB: USDt to IDRX on Textile FX, then all 18,439.70 IDRX to the recipient outside the team, with the evidence JSON saved

Not done yet:

- [ ] Record a demo video
- [ ] Submit the project on Loops House before 7 Dec 2026, 16:00 WIB (after the owner approves this draft and the payout)
