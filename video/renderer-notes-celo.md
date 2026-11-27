# Renderer notes - IDRX Payout Agent video renderer adaptation

## Overview
Adapt render_video.py from the reference pattern to render the IDRX Payout Agent demo video at 1920x1080, 10 fps, using PIL and ffmpeg.

## Key Changes in render_video.py
1. SECTION_CMDS mapping:
   - "2": ["$ node agent/idrx-payout-agent.mjs --dry-run"]
   - "3": ["$ node scripts/check-state.mjs 0x8F3E972f8006aE76D55385cF9Df8bF86160983AA"]
2. Timing and Durations:
   - Title card duration: 8.0 seconds (TITLE_S = 8)
   - Close card duration: 10.0 seconds (CLOSE_S = 10)
   - Total estimated duration: ~86 seconds.
3. Typography & Styling:
   - KeepDejaVuSansMono and DejaVuSans fonts as in reference.
   - Maintain color palette (BG, FG, GREEN, BLUE, MUTED, AMBER, BAND).
4. Compliance:
   - Ensure NO em dashes, en dashes, or non-breaking hyphens appear in any rendered text or terminal output.
   - Accurately represent all verified addresses, ERC-8004 agent ID 10131, swap transaction hashes, and status notes.
