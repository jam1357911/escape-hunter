# Escape Hunter

A turn-based pursuit game in two forms:

- **One file, zero setup** — [`index.html`](index.html) runs the whole game in
  any modern browser, offline, with no build step or dependencies.
- **Godot 4 project** — a native port of the original 1 hunter vs 1 fugitive
  hunt.

The board is **15 × 15**, and in the browser build you choose **1–5 hunters**,
**1–5 fugitives** and **20–60% walls** before each hunt. Random mazes are
always connected, and the fugitives get tired, so every hunt ends in a capture
or a clean escape instead of an endless draw.

![Escape Hunter in the browser](docs/screenshot-web.png)

## Play in the browser

Open [`index.html`](index.html) — double-click it, or drag it into a browser
tab. There is no server, no package install and no external asset: the whole
game is inline HTML, CSS and JavaScript.

### Setup panel

| Setting | Range | Effect |
| --- | --- | --- |
| **Hunters** | 1–5 | How many hunters you control. Each one moves once per round. |
| **Fugitives** | 1–5 | How many AI fugitives are on the board. |
| **Walls** | 20–60% | How much of the interior is wall. Higher values make tighter mazes. |
| **Difficulty** | Easy–Expert | How clever the fugitive AI is. |

**New hunt** (or **Restart**, or **R**) starts a fresh map with the current
settings. Settings are remembered in `localStorage`, and `?seed=123` in the
URL makes the map reproducible.

### Controls

| Input | Action |
| --- | --- |
| Arrow keys / WASD | Move the selected hunter one tile |
| Click / tap a hunter | Select it |
| Click / tap a neighbouring tile | Move the selected hunter there |
| 1–5 | Select hunter 1–5 |
| Swipe on the board | Move the selected hunter in that direction |
| On-screen D-pad (narrow screens) | Move the selected hunter |
| R | New hunt |
| Difficulty dropdown | Switch AI tier immediately |

The selected hunter has a cyan ring, and small blue dots mark its legal steps.
After a hunter moves, the next hunter that still has to move is selected
automatically.

## How a round works

1. You move **each hunter once** (one tile per hunter). Hunters cannot stand on
   each other.
2. Every active fugitive then moves one tile. Fugitives cannot step onto a
   hunter or onto each other.
3. Every fifth round the fugitives are exhausted and lose that move.
4. Stepping onto a fugitive captures it. A fugitive that reaches the exit
   escapes.

The hunt ends when every fugitive has been caught or has escaped:

- **CAUGHT** — every fugitive was caught. This is the only clean win for the
  hunters.
- **ESCAPED** — at least one fugitive reached the exit. The result card shows
  how many were caught and how many got away.

The footer tally updates live: caught / total, escaped, and how many are still
out there.

Rule 3 is the anti-draw rule. At equal speed a perfect evader can circle a loop
forever, so the fugitives have to hand the hunters a free step every five
rounds. That makes a capture reachable without turning the chase into a
walkover.

## Tuning the odds

Some starting points:

- **1 hunter vs 1 fugitive, 40%** — the original tight duel.
- **2 vs 2, 40–50%** — more hunters means more coordination, but fugitives
  can split up; a good middle ground.
- **1 vs 3, 30–40%** — a hard hunt: you must cut off the exit and pick them
  off one at a time.
- **3 vs 1, 50%** — a short, tactical sweep; try Hard or Expert for a chase.

More walls means more dead ends (good for hunters) but also more hiding
routes. Fewer walls favours the fugitives.

## Godot 4 project

The native build is the original 1 hunter vs 1 fugitive hunt: 15 × 15, 40%
walls, the same rest rule and AI tiers, but no setup panel. It needs Godot
**4.3** or newer (standard build, no C#). Import
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

The browser suite checks layout parsing, A* and BFS behaviour, 180 generated
maps across wall densities and actor counts, every AI tier's move legality,
capture/escape/rest rules, and 48 scripted battles.

Godot build:

```bash
godot --headless --path . --editor --quit   # first import (builds the class cache)
godot --headless --path . --script res://tests/smoke_test.gd
```
