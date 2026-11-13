'use strict';

/**
 * Logic checks for the single-file browser build.
 *
 * Run with: node tests/web_smoke_test.js
 *
 * The game code is pulled out of index.html and executed in Node, so these
 * tests exercise exactly the same source the browser runs.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  console.error('No inline <script> found in index.html');
  process.exit(1);
}

const compiled = new Module('escape-hunter-logic');
compiled.filename = path.join(os.tmpdir(), 'escape-hunter-logic.js');
compiled._compile(scriptMatch[1], compiled.filename);
const {
  Grid, Pathfinding, MapGenerator, FugitiveAI, Game,
  AI, TILE, same, manhattan, makeRng
} = compiled.exports;

let checks = 0;
let failures = 0;

function check(condition, label) {
  checks += 1;
  if (condition) {
    console.log('  ok    ' + label);
  } else {
    failures += 1;
    console.error('  FAIL  ' + label);
  }
}

function section(title) {
  console.log('\n' + title);
}

function settings(hunters, fugitives, walls, difficulty = AI.NORMAL) {
  return { hunters, fugitives, walls, difficulty };
}

// ---------------------------------------------------------------- layout ---
section('Layout parsing');
{
  const grid = new Grid();
  const spawns = grid.loadLayout([
    '#######',
    '#H...E#',
    '#.....#',
    '#....F#',
    '#######'
  ]);
  check(grid.w === 7 && grid.h === 5, 'layout sets the grid size');
  check(spawns && same(spawns.hunter, { x: 1, y: 1 }), 'hunter spawn is parsed');
  check(spawns && same(spawns.fugitive, { x: 5, y: 3 }), 'fugitive spawn is parsed');
  check(grid.exits.length === 1 && same(grid.exits[0], { x: 5, y: 1 }), 'exit is parsed');
  check(grid.isWall(0, 0), 'the border is solid');
  check(grid.isWalkable(5, 3), 'floor is walkable');
  check(grid.neighbors(1, 1).length === 2, 'neighbour lookup works');
}

// ------------------------------------------------------------ pathfinding ---
section('Pathfinding');
{
  const grid = new Grid(7, 5);
  const start = { x: 1, y: 1 };
  const goal = { x: 5, y: 3 };

  const path = Pathfinding.findPath(grid, start, goal);
  check(path.length === 6, 'A* path length matches Manhattan distance');
  check(same(path[path.length - 1], goal), 'the path ends on the goal');
  check(!path.some((cell) => same(cell, start)), 'the path excludes the start cell');

  const distances = Pathfinding.distanceField(grid, [start]);
  check(distances.get(1 * grid.w + 5) === 4, 'BFS distance field is correct');

  grid.setTile(2, 1, TILE.WALL);
  const detour = Pathfinding.findPath(grid, start, goal);
  check(!detour.some((cell) => cell.x === 2 && cell.y === 1), 'A* routes around walls');

  const next = Pathfinding.nextStep(grid, start, goal);
  check(manhattan(next, start) === 1, 'nextStep returns one tile');

  grid.setTile(4, 3, TILE.WALL);
  grid.setTile(5, 2, TILE.WALL);
  check(Pathfinding.findPath(grid, start, goal).length === 0, 'an unreachable goal returns no path');
  check(!Pathfinding.isReachable(grid, start, goal), 'isReachable agrees with findPath');
}

// ------------------------------------------------------------ generation ---
section('Map generation');
{
  const configs = [
    settings(1, 1, 20),
    settings(1, 1, 40),
    settings(2, 2, 40),
    settings(3, 3, 45),
    settings(5, 5, 60),
    settings(2, 4, 30)
  ];
  let broken = 0;
  let generated = 0;
  let minOpen = Infinity;
  let openAt20 = 0;
  let openAt60 = 0;

  for (const config of configs) {
    for (let seed = 0; seed < 30; seed++) {
      const grid = new Grid(15, 15);
      const spawns = MapGenerator.generate(grid, makeRng(seed * 7919 + 13), config);
      generated += 1;

      const open = grid.walkableCells().length;
      minOpen = Math.min(minOpen, open);
      if (config.walls === 20) openAt20 += open;
      if (config.walls === 60) openAt60 += open;

      const actors = [...spawns.cops, ...spawns.fugitives];
      const unique = new Set(actors.map((cell) => `${cell.x},${cell.y}`));
      let valid =
        spawns.cops.length === config.hunters &&
        spawns.fugitives.length === config.fugitives &&
        unique.size === actors.length &&
        grid.exits.length === 1;

      for (const actor of actors) {
        if (!valid) break;
        if (!grid.isWalkable(actor.x, actor.y)) valid = false;
        if (same(actor, grid.exits[0])) valid = false;
        if (!Pathfinding.isReachable(grid, actor, grid.exits[0])) valid = false;
      }

      if (!valid) broken += 1;
    }
  }

  check(broken === 0, `${generated} maps spawn the requested actors on a connected board`);
  check(minOpen >= 40, 'every map keeps enough open cells');
  check(openAt20 / 30 > openAt60 / 30, 'more walls means fewer open cells');
}

// -------------------------------------------------------------------- AI ---
section('Fugitive AI');
{
  const grid = new Grid();
  grid.loadLayout([
    '#########',
    '#.......#',
    '#..H....#',
    '#.F....E#',
    '#.......#',
    '#########'
  ]);
  const cops = [{ x: 3, y: 2 }, { x: 4, y: 4 }];
  const fugitive = { x: 2, y: 3 };
  const others = [{ x: 6, y: 3, status: 'active' }];

  for (const difficulty of [AI.EASY, AI.NORMAL, AI.HARD, AI.EXPERT]) {
    const ai = new FugitiveAI(difficulty);
    const move = ai.chooseMove(grid, cops, fugitive, others, 0);
    check(grid.isWalkable(move.x, move.y), `difficulty ${difficulty} returns a walkable tile`);
    check(manhattan(move, fugitive) === 1, `difficulty ${difficulty} moves exactly one tile`);
    check(!cops.some((cop) => same(cop, move)), `difficulty ${difficulty} never steps onto a hunter`);
    check(!others.some((other) => same(other, move)), `difficulty ${difficulty} never stacks on another fugitive`);
  }

  const expert = new FugitiveAI(AI.EXPERT);
  const expertMove = expert.chooseMove(grid, cops, fugitive, [], 0);
  check(cops.every((cop) => Math.max(Math.abs(expertMove.x - cop.x), Math.abs(expertMove.y - cop.y)) > 1),
    'Expert keeps out of every hunter\'s reach');

  const corner = new Grid(5, 5);
  const cornerAi = new FugitiveAI(AI.HARD);
  const trapped = cornerAi.chooseMove(corner, [{ x: 1, y: 2 }], { x: 1, y: 1 }, [], 0);
  check(corner.isWalkable(trapped.x, trapped.y), 'AI always returns a usable tile');
}

// --------------------------------------------------------- game state ----
section('Game state machine');
{
  const game = new Game(makeRng(42), settings(2, 2, 40));
  game.newGame();
  check(game.cops.length === 2 && game.fugitives.length === 2, 'the requested actor counts are built');
  check(game.phase === 'cops' && game.round === 1, 'a new game starts on the hunter phase');
  check(game.selectedCopId !== null, 'a hunter is selected');

  const selected = game.copById(game.selectedCopId);
  const targets = game.copTargets(selected);
  if (targets.length > 0) {
    const turnBefore = game.round;
    const result = game.moveSelected(targets[0].x - selected.x, targets[0].y - selected.y);
    check(result.kind !== 'ignored' && selected.moved, 'moving a hunter marks it as done');
    check(game.round === turnBefore, 'the round counter waits for the fugitive phase');
  } else {
    check(false, 'a hunter should have a legal move');
  }

  // Walking into a wall changes nothing.
  const wall = new Game(makeRng(7), settings(1, 1, 40));
  wall.newGame();
  const cop = wall.copById(wall.selectedCopId);
  let wallDirection = null;
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    if (!wall.grid.isWalkable(cop.x + dx, cop.y + dy)) { wallDirection = [dx, dy]; break; }
  }
  if (wallDirection) {
    const before = { x: cop.x, y: cop.y };
    const result = wall.moveSelected(wallDirection[0], wallDirection[1]);
    check(result.kind === 'blocked' && same(cop, before), 'walking into a wall changes nothing');
  } else {
    check(true, 'walking into a wall changes nothing (open map, skipped)');
  }

  // The fugitives rest every fifth round.
  const rest = new Game(makeRng(11), settings(1, 2, 40));
  rest.newGame();
  rest.round = 5;
  rest.beginFugitivePhase();
  check(rest.resting, 'round five is a rest round');
  check(rest.stepFugitive() === null, 'resting fugitives do not move');
  rest.round = 6;
  rest.beginFugitivePhase();
  check(!rest.resting && rest.stepFugitive() !== null, 'the next round the fugitives move again');

  // Capture ends a one-fugitive hunt immediately.
  const capture = new Game(makeRng(3), settings(1, 1, 40));
  capture.newGame();
  const prey = capture.fugitives[0];
  const hunter = capture.cops[0];
  hunter.x = prey.x + 1;
  hunter.y = prey.y;
  hunter.moved = false;
  capture.selectedCopId = hunter.id;
  capture.phase = 'cops';
  const captureResult = capture.moveSelected(-1, 0);
  check(captureResult.kind === 'capture', 'stepping onto a fugitive captures it');
  check(capture.outcome === 'cops' && capture.caught === 1, 'catching the last fugitive wins for the hunters');

  // Reaching the exit ends a one-fugitive hunt as an escape.
  const escape = new Game(makeRng(5), settings(1, 1, 40));
  escape.newGame();
  const exitCell = escape.grid.exits[0];
  escape.fugitives[0].x = exitCell.x;
  escape.fugitives[0].y = exitCell.y - 1;
  escape.grid.setTile(exitCell.x, exitCell.y - 1, TILE.FLOOR);
  escape.aiList[0].chooseMove = () => ({ x: exitCell.x, y: exitCell.y });
  escape.phase = 'fugitives';
  escape.resting = false;
  const escapeResult = escape.stepFugitive();
  check(escapeResult.kind === 'escaped' && escape.outcome === 'fugitives', 'reaching the exit wins for the fugitive');
}

// --------------------------------------------------------- full battles ---
section('Simulated battles');
{
  const configs = [
    settings(1, 1, 40),
    settings(2, 2, 40),
    settings(3, 2, 45),
    settings(2, 4, 35)
  ];
  let resolved = 0;
  let total = 0;

  for (const config of configs) {
    let broken = 0;
    for (let seed = 0; seed < 12; seed++) {
      const game = new Game(makeRng(seed * 104729 + 7), config);
      game.newGame();
      let guard = 0;

      while (game.phase !== 'over' && guard < 4000) {
        guard += 1;
        if (game.phase === 'cops') {
          const cop = game.copById(game.selectedCopId);
          if (!cop) {
            game.beginRound();
            continue;
          }
          const fugitive = game.activeFugitives()
            .slice()
            .sort((a, b) => manhattan(a, cop) - manhattan(b, cop))[0];
          const otherCops = game.cops.filter((other) => other !== cop);
          const path = fugitive ? Pathfinding.findPath(game.grid, cop, fugitive, otherCops) : [];
          let target = path.length > 0 ? path[0] : null;
          if (!target) {
            const targets = game.copTargets(cop);
            target = targets.length > 0 ? targets[0] : null;
          }
          if (!target) {
            cop.moved = true;
            const next = game.cops.find((other) => !other.moved) || null;
            game.selectedCopId = next ? next.id : null;
            if (!next) game.beginFugitivePhase();
            continue;
          }
          const result = game.moveSelected(target.x - cop.x, target.y - cop.y);
          if (result.kind === 'blocked') {
            cop.moved = true;
            const next = game.cops.find((other) => !other.moved) || null;
            game.selectedCopId = next ? next.id : null;
            if (!next) game.beginFugitivePhase();
          }
        } else if (game.resting) {
          game.endFugitivePhase();
        } else {
          const step = game.stepFugitive();
          if (!step) game.endFugitivePhase();
        }
      }

      total += 1;
      const actors = game.caught + game.escaped;
      const valid =
        game.phase === 'over' &&
        (game.outcome === 'cops' || game.outcome === 'fugitives') &&
        actors === game.totalFugitives &&
        game.activeFugitives().length === 0 &&
        (game.outcome === 'cops') === (game.escaped === 0);

      if (valid) resolved += 1;
      else broken += 1;
    }
    check(broken === 0, `${config.hunters}v${config.fugitives} at ${config.walls}% resolves cleanly`);
  }

  check(resolved === total, `every simulated hunt reached a capture/escape result (${resolved}/${total})`);
}

// -------------------------------------------------------------------- out ---
console.log(`\n${failures === 0 ? `ALL ${checks} CHECKS PASSED` : `${failures} of ${checks} CHECKS FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
