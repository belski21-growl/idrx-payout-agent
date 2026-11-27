# Renderer notes - IDRX Payout Agent video renderer adaptation (v2)

## Overview
Adapt render_video.py from the reference pattern to render the IDRX Payout Agent demo video at 1920x1080, 10 fps, using PIL and ffmpeg.

## Key Changes in render_video.py
1. SECTION_CMDS mapping:
   - "2": ["$ node agent/idrx-payout-agent.mjs --dry-run"]
   - "3": ["$ cast call 0x614f1778c1ab61eb9fb73d57f1e63a02bb44f0b0 'balanceOf(address)(uint256)' 0xAC9BD03F89C71A028107809432F27CbE16DF1aF8"]
   (Note: use read-only `cast call` balance checks or status commands; NEVER invent a script file; the Celo repo has no check-state script.)
2. Timing and Durations:
   - Title card duration: 8.0 seconds (TITLE_S = 8)
   - Close card duration: 10.0 seconds (CLOSE_S = 10)
   - Total estimated duration: ~86 seconds.
3. Typography & Styling:
   - Keep DejaVuSansMono and DejaVuSans fonts as in reference.
   - Maintain color palette (BG, FG, GREEN, BLUE, MUTED, AMBER, BAND).
4. Compliance & Payout Evidence Display:
   - Ensure NO em dashes, en dashes, or non-breaking hyphens appear in any rendered text or terminal output.
   - Display payout evidence: 3 transactions (approve `0xdc628523...` at block 83889424, swap `0x6413cd83...` at block 83889434, transfer `0xf9f01ba3...` at block 83889462), 1.00 USDT to 18,439.70 IDRX, and recipient balance 18,439.70 IDRX.
