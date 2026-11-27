#!/usr/bin/env python3
"""Render the IDRX Payout Agent demo video (v2, payout DONE) from
celo-v2.typescript / celo-v2.timing.

Adapted from the AevumEscrow reference renderer (proven lane pattern):
- Replays the live capture as a terminal at 10 fps.
- Injects the canonical `$ <command>` line after each `### N -` section
  header (script runs non-interactively, so commands do not echo).
- Title card up front, close card at the end.
- TIMING: command OUTPUT is verbatim from the live run. Waiting time is
  adjusted: each inter-chunk delay is capped at CHUNK_CAP (Forno cast
  calls took 11-16s each of dead RPC latency; the cap keeps the proof
  readable). The final terminal frame is then held so the close card
  starts at 76.0s video, matching the VO script (clip G starts 76.0s).
- DASH RULE: em dash / en dash / U+2011 in live output are rendered as
  plain "-" (no em/en dash anywhere in rendered text).
- CORRECT IDRX address throughout: 0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22
  (config.mjs:14). The 0x614f... address from renderer-notes v2 section 3
  is WRONG and is not used anywhere.
- Payout evidence is STATIC text (already on-chain); no tx was sent.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 1920, 1080
FPS = 10
COLS = 122
ROWS = 31
FONT_SIZE = 24
LINE_H = 31
MARGIN_X, MARGIN_Y = 64, 56
BG = (11, 15, 20)
FG = (201, 209, 217)
GREEN = (126, 231, 135)
BLUE = (88, 166, 255)
MUTED = (139, 148, 158)
AMBER = (255, 193, 7)
BAND = (16, 34, 56)
KEY_RE = re.compile(r"\d")
TITLE_S = 8
CLOSE_S = 10
CHUNK_CAP = 6.0
CLOSE_START = 76.0

from PIL import Image, ImageDraw, ImageFont

MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
MONO_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
SANS_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

SECTION_CMDS = {
    "2": ["$ node agent/idrx-payout-agent.mjs --dry-run"],
    "3": [
        '$ cast call $IDRX "balanceOf(address)(uint256)" $RECIPIENT --rpc-url $RPC',
        '$ cast call $REGISTRY "ownerOf(uint256)(address)" 10131 --rpc-url $RPC',
        '$ cast call $USDT "balanceOf(address)(uint256)" $WALLET --rpc-url $RPC',
        '$ cast call $IDRX "balanceOf(address)(uint256)" $WALLET --rpc-url $RPC',
    ],
}

ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][0-9A-B]|\x00")
HEADER_RE = re.compile(r"^### (\d+[a-z]?) - ")
DASH_RE = re.compile("[\u2014\u2013\u2011]")


def load_events(ts_path, timing_path):
    with open(ts_path, "rb") as f:
        raw = f.read()
    chunks = []
    total = 0.0
    with open(timing_path) as f:
        for line in f:
            parts = line.split()
            if len(parts) != 2:
                continue
            delay, nbytes = float(parts[0]), int(parts[1])
            delay = min(delay, CHUNK_CAP)
            total += delay
            chunks.append((total, raw[:nbytes]))
            raw = raw[nbytes:]
    if raw:
        chunks.append((total + 0.1, raw))
    return chunks


def replay(chunks):
    lines = []
    cur = ""
    events = []
    injected = set()
    section_times = {}
    pending_header = [None]

    def inject_cmds(n):
        if n in SECTION_CMDS and n not in injected:
            injected.add(n)
            for c in SECTION_CMDS[n]:
                lines.append((c, "cmd"))

    def flush_line():
        nonlocal cur
        if cur.startswith("Script started on") or cur.startswith("Script done on"):
            cur = ""
            return
        if cur:
            lines.append((cur, "plain"))
            m = HEADER_RE.match(lines[-1][0])
            if m and lines[-1][0].rstrip().endswith("###"):
                inject_cmds(m.group(1))
                pending_header[0] = None
            elif m:
                pending_header[0] = m.group(1)
            elif pending_header[0] is not None and lines[-1][0].rstrip().endswith("###"):
                inject_cmds(pending_header[0])
                pending_header[0] = None
            elif pending_header[0] is not None:
                pending_header[0] = None
        cur = ""

    def push_text(text):
        nonlocal cur
        text = DASH_RE.sub("-", text)
        i = 0
        while i < len(text):
            ch = text[i]
            if ch == "\r":
                if i + 1 < len(text) and text[i + 1] == "\n":
                    flush_line()
                    i += 2
                    continue
                cur = ""
                i += 1
                continue
            elif ch == "\n":
                flush_line()
                i += 1
            elif ch == "\b":
                cur = cur[:-1]
                i += 1
            else:
                cur += ch
                if len(cur) >= COLS:
                    flush_line()
                i += 1

    carry = ""
    for t, chunk in chunks:
        text = ANSI_RE.sub("", chunk.decode("utf-8", errors="replace"))
        text = carry + text
        carry = ""
        if text.endswith("\r"):
            carry = "\r"
            text = text[:-1]
        push_text(text)
        snap = lines + [(cur, "plain")] if cur else list(lines)
        events.append((t, snap))
        for line, _ in snap:
            m = HEADER_RE.match(line)
            if m and m.group(1) not in section_times:
                section_times[m.group(1)] = t
    if cur:
        flush_line()
    total = chunks[-1][0] if chunks else 0.0
    return events, total, section_times


def draw_rich_terminal(d, x, y, seg, font, font_b):
    parts = re.split(r"(\s+)", seg)
    cx = x
    for part in parts:
        if not part:
            continue
        if part.isspace():
            cx += font.getlength(part)
            continue
        if KEY_RE.search(part):
            d.text((cx, y), part, font=font_b, fill=AMBER)
            cx += font_b.getlength(part)
        else:
            d.text((cx, y), part, font=font, fill=FG)
            cx += font.getlength(part)


def draw_terminal(draw, snap_lines):
    font = ImageFont.truetype(MONO, FONT_SIZE)
    font_b = ImageFont.truetype(MONO_BOLD, FONT_SIZE)
    visible = snap_lines[-ROWS:]
    y = MARGIN_Y
    header_cont = False
    for text, kind in visible:
        is_header = text.startswith("###") or header_cont
        header_cont = is_header and len(text) >= COLS
        is_cmd = kind == "cmd"
        segs = []
        t = text
        while len(t) > COLS:
            segs.append(t[:COLS])
            t = t[COLS:]
        segs.append(t)
        for seg in segs:
            if is_header:
                draw.rectangle([MARGIN_X - 16, y - 4,
                                W - MARGIN_X + 16, y + LINE_H - 6], fill=BAND)
            if is_cmd:
                draw.text((MARGIN_X, y), seg, font=font_b, fill=GREEN)
            elif is_header:
                draw.text((MARGIN_X, y), seg, font=font_b, fill=BLUE)
            else:
                draw_rich_terminal(draw, MARGIN_X, y, seg, font, font_b)
            y += LINE_H


def draw_centered_rich(d, y, line, font, base):
    parts = re.split(r"(\s+)", line)
    total = sum(font.getlength(p) for p in parts if p)
    cx = (W - total) // 2
    for part in parts:
        if not part:
            continue
        if part.isspace():
            cx += font.getlength(part)
            continue
        color = AMBER if KEY_RE.search(part) else base
        d.text((cx, y), part, font=font, fill=color)
        cx += font.getlength(part)


def fit_font(path, size, line, max_w):
    while size > 20:
        f = ImageFont.truetype(path, size)
        if f.getlength(line) <= max_w:
            return f
        size -= 2
    return ImageFont.truetype(path, 20)


def draw_card(title_lines, sub_lines, accent, footer=None):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    f_title = ImageFont.truetype(SANS_BOLD, 112)
    f_small = ImageFont.truetype(SANS, 34)
    y = 290
    for line in title_lines:
        bb = d.textbbox((0, 0), line, font=f_title)
        d.text(((W - (bb[2] - bb[0])) // 2, y), line, font=f_title, fill=FG)
        y += 150
    rule_w = 420
    d.rectangle([(W - rule_w) // 2, y - 8, (W + rule_w) // 2, y - 2], fill=AMBER)
    y += 30
    for line in sub_lines:
        f_sub = fit_font(SANS_BOLD, 48, line, W - 2 * MARGIN_X)
        draw_centered_rich(d, y, line, f_sub, accent)
        y += 72
    d.text((MARGIN_X, H - 90),
           footer or "IDRX Payout Agent - Celo Mainnet",
           font=f_small, fill=MUTED)
    return img


def main():
    ts_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "celo-v2.typescript")
    timing_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "celo-v2.timing")
    frames_dir = sys.argv[3] if len(sys.argv) > 3 else os.path.join(HERE, "frames")
    os.makedirs(frames_dir, exist_ok=True)
    chunks = load_events(ts_path, timing_path)
    events, total, section_times = replay(chunks)
    print(f"session: {len(chunks)} chunks, {total:.1f}s terminal (capped at {CHUNK_CAP}s/chunk)")

    frames = 0

    def save(img):
        nonlocal frames
        img.save(os.path.join(frames_dir, f"frame_{frames:06d}.png"))
        frames += 1

    title = draw_card(["IDRX Payout Agent"],
                      ["Stablecoin corridors on Celo mainnet.",
                       "Celo Mainnet (Chain 42220) - Stablecoin Corridors Track"], BLUE)
    for _ in range(TITLE_S * FPS):
        save(title)

    def snap_at(t):
        snap = None
        for et, el in events:
            if et <= t:
                snap = el
            else:
                break
        return snap

    def terminal_frame(t):
        snap = snap_at(t)
        img = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(img)
        if snap:
            draw_terminal(d, snap)
        return img

    n_term = int(total * FPS) + 1
    for i in range(n_term):
        save(terminal_frame(i / FPS))

    hold_s = max(0.0, CLOSE_START - TITLE_S - total)
    last = terminal_frame(total)
    for _ in range(int(hold_s * FPS)):
        save(last)
    print(f"hold final frame: {hold_s:.1f}s (close card starts at {TITLE_S + total + hold_s:.1f}s video)")

    close = draw_card(["IDRX Payout Agent"],
                      ["https://github.com/belski21-growl/idrx-payout-agent",
                       "https://belski21-growl.github.io/idrx-payout-agent/",
                       "ERC-8004 Agent ID 10131 (Owner: 0x8F3E...83AA)",
                       "23/23 tests passing | Verified mainnet swaps and live payout execution",
                       "Payout COMPLETE (1.00 USDT -> 18,439.70 IDRX delivered 27 Nov 2026)"], GREEN)
    for _ in range(CLOSE_S * FPS):
        save(close)

    dur = frames / FPS
    print(f"frames: {frames}, duration: {dur:.1f}s ({dur/60:.2f} min)")
    print("section starts (terminal time, add title card):")
    for n in sorted(section_times):
        print(f"  S{n}: {section_times[n]:.1f}s terminal = {section_times[n] + TITLE_S:.1f}s video")
    print(f"  terminal ends: {total:.1f}s terminal = {total + TITLE_S:.1f}s video")
    print(f"  close card: {TITLE_S + total + hold_s:.1f}s video")
    if not (60 <= dur <= 180):
        print("WARNING: duration outside 1-3 min target!")


if __name__ == "__main__":
    main()
