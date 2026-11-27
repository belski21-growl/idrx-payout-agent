# Shot plan - IDRX Payout Agent demo video (v2)

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

## Section 3: On-Chain Proof & Payout Evidence (32.0s to 76.0s)
- On-screen text: On-Chain Proof & Payout Evidence
- Terminal content:
  Work wallet: 0x8F3E972f8006aE76D55385cF9Df8bF86160983AA
  Recipient: 0xAC9BD03F89C71A028107809432F27CbE16DF1aF8
  ERC-8004 Agent ID: 10131 (tx: 0x4fc5e5e4...82, block 83720943)
  Funding: 14 CELO swapped -> 0.711710 USD₮ (tx: 0xa3f7fcb6...ff, block 83889289)
  Previous swaps: 2 CELO -> 0.103105 USD₮ (tx: 0x5e298f01...ba), 4.25 CELO -> 0.213413 USD₮ (tx: 0xb75ff647...58)
  Payout execution (firm quote rfq_8MOq_ogcAwK_gQMy, 1.00 USD₮ -> 18,439.70 IDRX):
  - Approve tx: 0xdc628523d91de9e06826d4001af3faef5ec7590f980df7a51d0b27b0ab67c5cf (block 83889424, success)
  - Textile FX Swap tx: 0x6413cd8361e2f1c06d09f08663cfb23550020044d9c94fb472bfa18c15fa30c1 (block 83889434, success)
  - Transfer IDRX tx: 0xf9f01ba3f6c8f867838b25d38c8ebd4e4fdd2ad8872ed7c27a4cf2f61cf7147c (block 83889462, success)
  Balances after: Recipient IDRX 18,439.70 (verified), Work IDRX 0, Remaining USD₮ 0.028228
  Status: Payout COMPLETE (23/23 tests passing)
- Viewer understanding: Verification of ERC-8004 registration, liquidity swaps, Textile FX minimum floor compliance, and successful live payout execution.

## Section 4: Close Card (76.0s to 86.0s)
- On-screen text: IDRX Payout Agent | GitHub & Live Demo | 23/23 Tests Passing
- Terminal content: None (Close overlay card)
- Viewer understanding: Where to access code, live demo, and test results.
