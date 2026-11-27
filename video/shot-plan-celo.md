# Shot plan - IDRX Payout Agent demo video

## Section 1: Title Card (0.0s to 8.0s)
- On-screen text: IDRX Payout Agent | Celo Mainnet (Chain 42220) | Stablecoin Corridors Track
- Terminal content: None (Title overlay card)
- Viewer understanding: Introduction to the project name, network, and hackathon track.

## Section 2: Problem & Dry-Run Execution (8.0s to 32.0s)
- On-screen text: Problem & Read-Only Dry-Run
- Terminal content:
  $ node agent/idrx-payout-agent.mjs --dry-run
  Preview: sell 0.1 USD₮ -> buy ~1844.08 IDRX | fee 0.000019 USD₮
  USD₮ 0.316518 | CELO 0.176150 | IDRX 0
  Dry run complete. No key was used, no signature was made, nothing was sent.
- Viewer understanding: How the agent solves the conversion problem and simulates transactions safely without keys or signatures.

## Section 3: On-Chain Proof & Status (32.0s to 76.0s)
- On-screen text: On-Chain Proof & Status
- Terminal content:
  Work wallet: 0x8F3E972f8006aE76D55385cF9Df8bF86160983AA
  Recipient: 0xAC9BD03F89C71A028107809432F27CbE16DF1aF8
  ERC-8004 Agent ID: 10131 (tx: 0x4fc5e5e4...82)
  Ubeswap swaps: 2 CELO -> 0.103 USD₮ (tx: 0x5e298f01...ba), 4.25 CELO -> 0.213 USD₮ (tx: 0xb75ff647...58)
  Textile FX floor test: $1.00 minimum enforced (0.10 USD₮ request rejected HTTP 400)
  Status: Payout run pending funding (wallet $0.32 USD₮, floor $1.00)
- Viewer understanding: Verification of ERC-8004 registration, liquidity swaps, Textile FX minimum floor enforcement, and transparent funding status.

## Section 4: Close Card (76.0s to 86.0s)
- On-screen text: IDRX Payout Agent | GitHub & Live Demo | 23/23 Tests Passing
- Terminal content: None (Close overlay card)
- Viewer understanding: Where to access code, live demo, and test results.
