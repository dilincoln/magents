#!/usr/bin/env python3
"""
Builds assets/soundtrack.mp3 from assets/music.mp3 by splicing at bar lines.

The track is 132 bpm with its first beat at 1.8325 s, so bar n starts at
1.8325 + 1.81808·n. Measured with a bar-by-bar spectral comparison:

  bars  0–7    intro; bars 4–7 repeat 0–3 (the last one builds into the drop)
  bars  8–23   the chorus: one 8-bar phrase, 8–15, played twice (16–23)
  bars 24–39   breakdown
  bar  40      build
  bars 41–56   the chorus again
  bar  57      the final hit, then the tail

Bar 23 is the same as bar 15 and as bar 56, so the end of bar 23 can go
straight into bar 16 (it sounds like 15 → 16) or into bar 57 (like 56 → 57).
Bar 4 is the same as bar 0, so the end of bar 3 can go back to bar 0.

To make the film longer or shorter, change CHORUS_LOOPS (8 bars ≈ 14.5 s
each), CHORUS_HALVES (4 bars ≈ 7.3 s) or INTRO_REPEAT, run this, and move
the scenes in lib/film.js and index.html.

    python3 soundtrack.py
"""

import subprocess
from pathlib import Path

T0 = 1.8325
BAR = 4 * 0.45452
END = 109.427  # the source's length

INTRO_REPEAT = True  # bars 0–3 twice before 4–7: a 12-bar intro
CHORUS_LOOPS = 6  # extra passes of the bars 16–23 phrase
# extra passes of its second half, bars 20–23: the phrase is two near-equal
# halves, so this is the 4-bar step (≈7.3 s) when 8 bars is too coarse
CHORUS_HALVES = 1

bar = lambda n: T0 + n * BAR

segments = []
if INTRO_REPEAT:
    segments.append((0.0, bar(4)))  # the pickup and bars 0–3
    segments.append((bar(0), bar(24)))  # bars 0–23
else:
    segments.append((0.0, bar(24)))
segments += [(bar(16), bar(24))] * CHORUS_LOOPS
segments += [(bar(20), bar(24))] * CHORUS_HALVES
segments.append((bar(57), END))  # the last hit and its tail

here = Path(__file__).parent
src = here / "assets" / "music.mp3"
out = here / "assets" / "soundtrack.mp3"

# every cut is a 20 ms crossfade centred on the bar line: each segment is cut
# 10 ms long on both sides so the fades overlap exactly on the seam
PAD = 0.01
parts, chain = [], ""
for i, (a, b) in enumerate(segments):
    a2 = max(0.0, a - (PAD if i else 0))
    b2 = min(END, b + (PAD if i < len(segments) - 1 else 0))
    parts.append(f"[0:a]atrim={a2:.4f}:{b2:.4f},asetpts=PTS-STARTPTS[s{i}]")
prev = "s0"
for i in range(1, len(segments)):
    chain += f";[{prev}][s{i}]acrossfade=d={2 * PAD}:c1=tri:c2=tri[x{i}]"
    prev = f"x{i}"
graph = ";".join(parts) + chain

subprocess.run(
    ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-filter_complex", graph,
     "-map", f"[{prev}]", "-c:a", "libmp3lame", "-b:a", "256k", str(out)],
    check=True,
)

total = sum(b - a for a, b in segments)
bars = round((total - (END - bar(57)) - T0) / BAR)
print(f"{out.name}: {total:.3f} s — {bars} bars, then the {END - bar(57):.2f} s ending")
