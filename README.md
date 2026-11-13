# Escape Hunter

A turn-based pursuit game in two forms:

- **One file, zero setup** — [`index.html`](index.html) runs the whole game in
  any modern browser, offline, with no build step or dependencies.
- **Godot 4 project** — a native port of the original 1 hunter vs 1 fugitive
  hunt.

The board is **15 × 15**. In the browser build you choose whether to play as
the **hunters** or the **fugitives**, how many of each (1–5), and **0–60%
walls**. Hunters act in a fixed rotation; every active fugitive answers each
round. Random mazes are always connected, so the chase is decided by
positioning, not by a sealed-off spawn.

![Escape Hunter in the browser](docs/screenshot-web.png)

## Play in the browser

Open [`index.html`](index.html) — double-click it, or drag it into a browser
tab. There is no server, no package install and no external asset: the whole
game is inline HTML, CSS and JavaScript.

### Setup panel

| Setting | Range | Effect |
| --- | --- | --- |
| **Play as** | Hunters / Fugitives | Which side you control. |
| **Hunters** | 1–5 | Hunters in play. They move one at a time in a fixed rotation. |
| **Fugitives** | 1–5 | Fugitives in play. Every active fugitive moves each round. |
| **Walls** | 0–60% | Wall coverage. 0% is a completely open room; 60% is a dense maze. |
| **Difficulty** | Easy–Expert | Skill of the side the AI controls. |

**New hunt** (or **Restart**, or **R**) starts a fresh map with the current
settings. Settings are remembered in `localStorage`, and `?seed=123` in the
URL makes the map reproducible.

### Controls

| Input | Action |
| --- | --- |
| Arrow keys / WASD | Move the unit whose turn it is |
| Click / tap a neighbouring tile | Move the active hunter, or the selected fugitive |
| Click / tap a fugitive (playing as fugitives) | Select that fugitive |
| 1–5 | Select one of your fugitives (fugitive side only) |
| Swipe on the board | Move the active unit in that direction |
| On-screen D-pad (narrow screens) | Move the active unit |
| R | New hunt |
| Difficulty dropdown | Switch AI tier immediately |

The hunter whose turn it is has a cyan ring and blue dots on its legal steps —
you cannot choose a different hunter; the rotation decides. When you play as
the fugitives, the ring is on the fugitive you have selected, and each active
fugitive may move once per round.

![Playing as the fugitives](docs/screenshot-web-fugitive.png)

## How a round works

The same sequence runs for both sides; only who controls each phase changes.

1. **Hunter phase.** One hunter acts — the next one in the rotation. You move
   it when playing hunters; the AI moves it when playing fugitives. A boxed-in
   hunter skips its turn.
2. **Fugitive phase.** Every active fugitive moves one tile. You move them
   when playing fugitives; the AI moves them when playing hunters. Fugitives
   cannot step onto a hunter or onto each other.
3. Stepping onto a fugitive captures it. A fugitive that reaches the exit
   escapes.

The hunt ends **immediately** when either side has won:

- **CAUGHT** — every fugitive was caught. The hunters win.
- **ESCAPED** — a fugitive reached the exit. The fugitives win.

The result card shows **YOU WIN** or **YOU LOSE** from your side, and the
footer tally updates live: caught / total and escaped.

![Result card](docs/screenshot-web-result.png)

There is no fatigue rule. At equal speed a perfect evader can keep circling, so
a hunt can run long: hunters win by cutting off the exit and using dead ends.
If a chase stalls, **New hunt** (or **R**) starts a fresh map.

## Tuning the odds

Some starting points:

- **Hunter, 1 vs 1, 40%** — the tight duel. Cutting the exit off is essential;
  a straight chase can go on for a long time.
- **Hunter, 3 vs 2, 55%** — a tactical sweep; the rotation means only one
  hunter acts per round, so position the others for later turns.
- **Fugitive, 1 vs 2, 45%** — split the fugitives up and time a run for the
  exit while the AI hunter is busy.
- **Fugitive, 1 vs 3, 30%** — one hunter, three fugitives and an open map: a
  good place to practise dodging.

More walls means more dead ends (good for hunters) but also more hiding
routes. Fewer walls favours the fugitives; 0% is a pure open-field chase.

## Godot 4 project

The native build is the original 1 hunter vs 1 fugitive hunt: 15 × 15, 40%
walls, the same AI tiers, but no setup panel, no side selection and no fatigue
rule. It needs Godot **4.3** or newer (standard build, no C#). Import
[`project.godot`](project.godot), then press **F5**; from a terminal:

```bash
godot --path .
```

It uses the *GL Compatibility* renderer and draws the board procedurally, so
there is no tileset or sprite import step.

![Godot build](docs/screenshot.png)

## AI tiers

| Tier | Behaviour |
| --- | --- |
| **Easy** | Uniform random legal move. |
| **Normal** | Breadth-first exit distance field; steps to the neighbour closest to the nearest exit. |
| **Hard** | Same exit pull, plus a threat cost from the nearest hunter, so it slides around the hunters instead of into them. |
| **Expert** | A* route to the nearest exit, scored with a 3-turn pursuit simulation against *all* hunters, a dead-end penalty, and a bonus for keeping several forward escape routes open. |

More details:

- Normal, Hard and Expert remember the last four tiles they left and avoid
  pacing between the same two cells.
- After a while the fugitive stops dodging and commits to the exit — after 8
  rounds on Easy, 14 on Normal, 20 on Hard and 30 on Expert.
- The Expert tier treats every tile next to any hunter as almost forbidden
  while it still has room to dodge.

When you play as the fugitives, the AI controls the hunters instead:

| Hunter AI | Behaviour |
| --- | --- |
| **Easy** | Picks a random legal move. |
| **Normal** | Chases the nearest fugitive with A*. |
| **Hard / Expert** | Tries to reach a point on the fugitive's exit route before the fugitive gets there, and chases hard otherwise. |

## Map generation

The browser build uses the settings above; the Godot build uses 40% walls.

1. Fill the board and keep a solid border.
2. Scatter walls over the requested percentage of the interior, then join every
   isolated pocket to the main region by carving a 4-neighbour tunnel. The
   result is a dense maze that is always solvable for the actors' movement
   rules.
3. Reject the layout unless enough cells are open and all floor tiles are
   connected (up to 80 attempts).
4. Place the exit at random. Place the hunters and fugitives on distinct floor
   tiles so that fugitives start at least 6 steps from every hunter and from
   the exit, no hunter starts within 2 steps of the exit, and at least one
   hunter starts closer to the exit than every fugitive. These gaps relax if
   the map is cramped.
5. If generation somehow fails, an open fallback arena is used.

## Project structure

```
escape-hunter/
├── index.html               # complete browser build (HTML + CSS + JS)
├── project.godot
├── icon.svg
├── docs/
│   ├── screenshot-web.png
│   ├── screenshot-web-fugitive.png
│   ├── screenshot-web-result.png
│   └── screenshot.png
├── scenes/
│   └── main.tscn            # Godot layout only: header, board frame, footer, modal
├── scripts/
│   ├── game_manager.gd      # turn state machine, win checks, wiring (scene root)
│   ├── grid_manager.gd      # tile data, neighbours, ASCII layout parser
│   ├── map_generator.gd     # random walls + spawn/exit placement
│   ├── pathfinding_system.gd# A* and BFS distance fields
│   ├── player_controller.gd # input -> one legal hunter step
│   ├── fugitive_ai.gd       # Easy / Normal / Hard / Expert policies
│   ├── board_view.gd        # Control that draws the grid and actors
│   └── hud.gd               # text, styling, difficulty picker, result modal
└── tests/
    ├── smoke_test.gd        # headless Godot logic checks
    └── web_smoke_test.js    # browser-build logic checks (Node)
```

### Responsibilities

The browser build keeps the same separation inside `index.html`:

- **Grid** — tile types, exits, bounds and neighbour queries.
- **Pathfinding** — stateless A* routes and BFS distance fields.
- **MapGenerator** — connected random walls, then actor and exit placement.
- **FugitiveAI** — returns one destination tile per fugitive per round;
  considers every hunter and the other fugitives as blocked.
- **Game** — round/phase state, hunter selection, captures, escapes, tallies.
- **UI section** — setup controls, keyboard/pointer input, canvas drawing, HUD
  and the result modal.

The Godot build mirrors this with nodes; **GameManager** owns the turn state,
**PlayerController** validates one step, **BoardView** draws, and **GameHUD**
owns the labels and modal.

## Tests

Browser build (Node 18+, no packages):

```bash
node tests/web_smoke_test.js
```

The browser suite checks layout parsing, A* and BFS behaviour, 175 generated
maps across wall densities (including 0%), side selection and hunter rotation,
both AI controllers, the capture/escape rules, and 60 scripted battles from
both sides (most resolve; hunts can legitimately run long now that there is no
fatigue rule).

Godot build:

```bash
godot --headless --path . --editor --quit   # first import (builds the class cache)
godot --headless --path . --script res://tests/smoke_test.gd
```
