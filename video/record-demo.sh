#!/bin/bash
# record-demo.sh - drives the IDRX Payout Agent demo-video terminal session.
# Run under `script` for timing capture. READ-ONLY: node --dry-run (no key,
# no signature, no tx) + cast eth_call reads against Forno. No key, no tx,
# no faucet, no registration, no submit.
# Section timing targets (video): title 0-8s, problem 8-20s, dry-run 20-46s,
# proof 46-76s, close 76-86s. Only waiting time is synthetic (sleeps below);
# every command output is verbatim from the live run.
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
sleep 8

say '2 - LIVE DRY-RUN: the agent previews the USDt to IDRX bridge on Celo mainnet. Read-only, no key, no signature.'
node agent/idrx-payout-agent.mjs --dry-run
sleep 6

say '3 - ON-CHAIN PROOF: ERC-8004 registration, work wallet balances, and the two verified Ubeswap swaps.'
cast call $REGISTRY "ownerOf(uint256)(address)" 10131 --rpc-url $RPC
cast call $USDT "balanceOf(address)(uint256)" $WALLET --rpc-url $RPC
cast balance $WALLET --rpc-url $RPC
cast call $IDRX "balanceOf(address)(uint256)" $WALLET --rpc-url $RPC
cast call $IDRX "balanceOf(address)(uint256)" $RECIPIENT --rpc-url $RPC
printf '  ERC-8004 agent ID 10131, owner 0x8F3E...83AA (tx 0x4fc5e5e4...82, block 83720943)\n'
printf '  Ubeswap swap 1: 2 CELO -> 0.103105 USDt (tx 0x5e298f01...ba)\n'
printf '  Ubeswap swap 2: 4.25 CELO -> 0.213413 USDt (tx 0xb75ff647...58, block 83721910)\n'
printf '  Textile FX floor: $1.00 minimum enforced (0.10 USDt request rejected HTTP 400)\n'
sleep 6

say '4 - STATUS: the $1.00 payout run has not executed yet. 23 of 23 tests pass.'
USDT_RAW=$(cast call $USDT "balanceOf(address)(uint256)" $WALLET --rpc-url $RPC | awk '{print $1}')
USDT_HUMAN=$(awk -v r="$USDT_RAW" 'BEGIN{printf "%.6f", r/1000000}')
printf '  Work wallet USDt right now: %s (Textile floor $1.00)\n' "$USDT_HUMAN"
printf '  IDRX paid out so far: 0 (work wallet IDRX 0, recipient IDRX 0)\n'
printf '  Tests: 23/23 passing\n'
sleep 8
