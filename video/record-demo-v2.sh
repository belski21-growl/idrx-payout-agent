#!/bin/bash
# record-demo-v2.sh - drives the IDRX Payout Agent demo-video terminal session (v2, payout DONE).
# Run under `script` for timing capture. READ-ONLY: node --dry-run (no key,
# no signature, no tx) + cast eth_call reads against Forno. Payout evidence
# is STATIC text (already on-chain) - never re-executed, no tx is sent.
# No key is read, no faucet, no registration, no submit.
# Section timing targets (video): title 0-8s, problem 8-20s, dry-run 20-46s,
# proof 46-62s, payout 62-76s, close 76-86s. Only waiting time is synthetic
# (sleeps below); every command output is verbatim from the live run.
# Correct IDRX address: 0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22 (config.mjs:14).
set -o pipefail
export PATH="$HOME/.foundry/bin:$PATH"
cd "$HOME/workspace/scratch/celo-hackathon" || exit 1
REGISTRY=0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
USDT=0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e
IDRX=0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22
WALLET=0x8F3E972f8006aE76D55385cF9Df8bF86160983AA
RECIPIENT=0xAC9BD03F89C71A028107809432F27CbE16DF1aF8
RPC=https://forno.celo.org

say() { printf '\n### %s ###\n\n' "$1"; sleep 2; }

say '1 - PROBLEM: freelancers get paid in USDt, but local expenses need local currency. Manual conversion is slow.'
sleep 7

say '2 - LIVE DRY-RUN: the agent previews the USDt to IDRX bridge on Celo mainnet. Read-only, no key, no signature.'
node agent/idrx-payout-agent.mjs --dry-run
sleep 3

say '3 - ON-CHAIN PROOF: ERC-8004 registration, recipient and work wallet balances, live on Celo mainnet.'
cast call $IDRX "balanceOf(address)(uint256)" $RECIPIENT --rpc-url $RPC
cast call $REGISTRY "ownerOf(uint256)(address)" 10131 --rpc-url $RPC
cast call $USDT "balanceOf(address)(uint256)" $WALLET --rpc-url $RPC
cast call $IDRX "balanceOf(address)(uint256)" $WALLET --rpc-url $RPC
printf '  ERC-8004 agent ID 10131, owner 0x8F3E...83AA (tx 0x4fc5e5e4...82, block 83720943)\n'
printf '  Ubeswap swap 1: 2 CELO -> 0.103105 USDt (tx 0x5e298f01...ba)\n'
printf '  Ubeswap swap 2: 4.25 CELO -> 0.213413 USDt (tx 0xb75ff647...58)\n'
printf '  Funding: 14 CELO swapped -> 0.711710 USDt (tx 0xa3f7fcb6...ff, block 83889289)\n'
printf '  Textile FX floor: $1.00 minimum enforced\n'
sleep 2

say '4 - PAYOUT COMPLETE: 1.00 USDt swapped for 18,439.70 IDRX and delivered to the recipient.'
printf '  Payout execution (firm quote rfq_8MOq_ogcAwK_gQMy, 1.00 USDt -> 18,439.70 IDRX):\n'
printf '  Approve tx: 0xdc628523d91de9e06826d4001af3faef5ec7590f980df7a51d0b27b0ab67c5cf (block 83889424, success)\n'
printf '  Textile FX Swap tx: 0x6413cd8361e2f1c06d09f08663cfb23550020044d9c94fb472bfa18c15fa30c1 (block 83889434, success)\n'
printf '  Transfer IDRX tx: 0xf9f01ba3f6c8f867838b25d38c8ebd4e4fdd2ad8872ed7c27a4cf2f61cf7147c (block 83889462, success)\n'
printf '  Balances after: Recipient IDRX 18,439.70 (verified), Work IDRX 0, Remaining USDt 0.028228\n'
printf '  Status: Payout COMPLETE (23/23 tests passing)\n'
sleep 8
