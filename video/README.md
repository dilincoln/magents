# magents — presentation video

A two-and-a-half-minute launch film for magents, made with [HyperFrames](https://hyperframes.heygen.com):
HTML, CSS and a paused GSAP timeline, rendered to MP4 by headless Chrome.

```bash
npx hyperframes preview          # the browser editor
npx hyperframes snapshot --at 22,36,50
npx hyperframes render --output renders/magents.mp4
```

## Every terminal in it is the real TUI

The screens are not mock-ups. `capture/` runs the actual magents daemon and TUI
from this repository, drives them with keystrokes, and records what the terminal
showed, cell by cell:

```
capture/reset          a throwaway world in /tmp/mgv-scratch: fake $HOME, four git
                       repos, skills, a fresh magents database — then the daemon
capture/populate.sh    four projects, four groups, eight sessions, through the CLI
capture/fake-agent.ts  stands in for `claude` and `codex` on PATH: draws a screen
                       shaped like each CLI, plays a canned turn, fires the hook
capture/takes/*.ts     one scripted interaction each — keys and clicks on the beat
capture/mouse.ts       clicks and drags as SGR mouse bytes, through tmux send-keys -H
capture/record.ts      sends the keys through tmux and samples `capture-pane -e`
capture/record-all     every take, in order, from a fresh world
```

Nothing talks to a model: the agents are `fake-agent.ts`, and the daemon's model
lists come from canned answers it gives the Claude SDK and a codex model cache.

Everything runs inside a private user + mount namespace (`capture/ns`) in which
the scratch tree is mounted at `/home/demo`, so paths read like an ordinary
machine. The real `/home` is never touched. `capture/inns <cmd>` runs a command
inside it, and `capture/t` is tmux pointed at the capture server.

A take is written to `takes/<name>.js`: every distinct screen as rows of HTML,
deduplicated, with timestamps. `lib/term.js` plays one back as a pure function of
time and `lib/term.css` draws it — box-drawing and block characters are painted
edge to edge, as a terminal's own renderer does, so borders and the wordmark have
no seams. `capture/sheet` and `capture/shot` make PNGs of a take for review;
their pages are templates (`*.html.in`) written out to `/tmp/mgv-review`, so the
only HTML in the project is the film itself.

## Scenes

`index.html` holds the music, the backdrop, the flash on the big hits, and one
host per scene; each scene is its own file in `compositions/`, mounted with
`data-composition-src`:

```
intro  drop  roster  attach  attention  spawn  groups  daemon  cli  search  input  recap  outro
```

A scene runs on its own clock, from 0 at its host's `data-start`. The feature
scenes each carry their own copy of the product window, in the same place, so
one hands over to the next without a seam; whatever moves the window (the
roster's push-in, the CLI's step back, the bow before the recap) puts it back
by the scene's end. `lib/film.js` is what they are built from: the beat grid,
`screen()` for a recorded screen, `product()` for the window and its halo,
`caption()` and `lens()`.

## Timing

The soundtrack (`assets/soundtrack.mp3`) is built from `assets/music.mp3` by
`soundtrack.py`, which splices it at bar lines: a 12-bar intro (bars 0–3 played
twice), the 16-bar chorus, six more passes of its 8-bar phrase and one of its
4-bar second half, then the track's own final hit — 151 s in all. The chorus
phrase is measured to repeat almost exactly, so each seam sounds like the
original's own phrase change; `CHORUS_LOOPS` and `CHORUS_HALVES` make the film
longer or shorter in steps of 14.5 s and 7.3 s.

It is 132 bpm with its first beat at 1.8325 s — fitted from
`hyperframes audio --only beats` — and every scene, caption, cut and pop is
placed with `beat(k)` / `bar(n)` from that grid (`lib/film.js`). A scene gets
the grid shifted onto its own clock, `s.beat(k)` / `s.bar(n)`, and names the
film time it starts at, which must match its host's `data-start` in
`index.html`. Takes schedule
their key presses on the same grid, so a cursor step or a keystroke in the
recorded TUI lands on a beat too.

Recorded screens play through `window.__hyperframes.registerFrameSource` on timed
hosts; `data-playback-start` says which moment of the take a host opens on.
A take also keeps its labelled keys and every click (`events`), which is how the
keyboard & mouse scene draws its pointer and keycaps exactly where and when the
recording did; lenses open and close on the frames where what they magnify is
actually on screen.

## Re-recording

```bash
capture/record-all          # ~4 minutes; rewrites takes/*.js
bun capture/lit.ts attention "fix flaky" "JIRA-1979" "review the API"
```

`lit.ts` prints when roster rows light up; the `data-playback-start` and the
rings in `compositions/attention.html` are aligned to those times.
