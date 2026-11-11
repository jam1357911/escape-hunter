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

// ---------------------------------------------------------------- layout ---
section('Layout parsing');
{
  const grid = new Grid();
  const spawns = grid.loadLayout(MapGenerator.FALLBACK_LAYOUT);
  check(grid.w === 13 && grid.h === 7, 'layout sets the grid size');
  check(spawns && same(spawns.hunter, { x: 1, y: 1 }), 'hunter spawn is parsed');
  check(spawns && same(spawns.fugitive, { x: 6, y: 5 }), 'fugitive spawn is parsed');
  check(grid.exits.length === 1 && same(grid.exits[0], { x: 11, y: 1 }), 'exit is parsed');
  check(grid.isWall(0, 0), 'the border is solid');
  check(grid.isWalkable(6, 5), 'floor is walkable');
  check(grid.neighbors(6, 5).length === 3, 'neighbour lookup works');
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
  let broken = 0;
  let minOpen = Infinity;
  let maxOpen = 0;
  let exitGapTotal = 0;

  for (let seed = 0; seed < 200; seed++) {
    const grid = new Grid(13, 7);
    const spawns = MapGenerator.generate(grid, makeRng(seed * 7919 + 13));
    const open = grid.walkableCells().length;
    minOpen = Math.min(minOpen, open);
    maxOpen = Math.max(maxOpen, open);

    const valid =
      spawns && grid.isWalkable(spawns.hunter.x, spawns.hunter.y) &&
      grid.isWalkable(spawns.fugitive.x, spawns.fugitive.y) &&
      !same(spawns.hunter, spawns.fugitive) &&
      grid.exits.length >= 1;

    if (!valid) {
      broken += 1;
      continue;
    }
    const exitCell = grid.exits[0];
    exitGapTotal += manhattan(spawns.fugitive, exitCell);
    if (
      same(spawns.hunter, exitCell) ||
      same(spawns.fugitive, exitCell) ||
      !Pathfinding.isReachable(grid, spawns.hunter, spawns.fugitive) ||
      !Pathfinding.isReachable(grid, spawns.fugitive, exitCell)
    ) {
      broken += 1;
    }
  }

  check(broken === 0, '200 random maps spawn both actors and a reachable exit');
  check(minOpen >= 26, 'generated maps keep enough open space');
  check(exitGapTotal / 200 >= 5, 'the fugitive starts well away from the exit');
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
  const hunter = { x: 3, y: 2 };
  const fugitive = { x: 2, y: 3 };

  for (const difficulty of [AI.EASY, AI.NORMAL, AI.HARD, AI.EXPERT]) {
    const ai = new FugitiveAI(difficulty);
    const move = ai.chooseMove(grid, hunter, fugitive, 0);
    check(grid.isWalkable(move.x, move.y), `difficulty ${difficulty} returns a walkable tile`);
    check(manhattan(move, fugitive) === 1, `difficulty ${difficulty} moves exactly one tile`);
    check(!same(move, hunter), `difficulty ${difficulty} never steps onto the hunter`);
  }

  const expert = new FugitiveAI(AI.EXPERT);
  const expertMove = expert.chooseMove(grid, hunter, fugitive, 0);
  check(Math.max(Math.abs(expertMove.x - hunter.x), Math.abs(expertMove.y - hunter.y)) > 1,
    'Expert keeps out of the hunter\'s reach');

  const corner = new Grid(5, 5);
  const cornerAi = new FugitiveAI(AI.HARD);
  const trapped = cornerAi.chooseMove(corner, { x: 1, y: 2 }, { x: 1, y: 1 }, 0);
  check(corner.isWalkable(trapped.x, trapped.y), 'AI always returns a usable tile');
}

// --------------------------------------------------------- game state ----
section('Game state machine');
{
  const game = new Game(makeRng(42), AI.NORMAL);
  game.newGame();
  check(game.state === 'player' && game.turn === 0, 'a new game starts on the player turn');

  const walls = [];
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    if (!game.grid.isWalkable(game.hunter.x + dx, game.hunter.y + dy)) walls.push([dx, dy]);
  }
  if (walls.length > 0) {
    const result = game.move(walls[0]);
    check(result.kind === 'blocked' && game.turn === 0 && game.state === 'player',
      'walking into a wall changes nothing');
  } else {
    check(true, 'walking into a wall changes nothing (open map, skipped)');
  }

  let guard = 0;
  while (game.state !== 'over' && guard < 300) {
    guard += 1;
    if (game.state === 'player') {
      const next = Pathfinding.nextStep(game.grid, game.hunter, game.fugitive);
      const direction = [next.x - game.hunter.x, next.y - game.hunter.y];
      if (game.move(direction).kind === 'blocked') break;
    } else {
      game.moveFugitive();
    }
  }
  check(game.state === 'over' && (game.outcome === 'hunter' || game.outcome === 'fugitive'),
    'a scripted game reaches a result');
  check(game.turn > 0, 'the turn counter advanced');

  // A fugitive walking onto the exit must end the game immediately.
  const escapeGame = new Game(makeRng(7), AI.NORMAL);
  escapeGame.newGame();
  const exitCell = escapeGame.grid.exits[0];
  escapeGame.state = 'fugitive';
  escapeGame.fugitive = { x: exitCell.x, y: exitCell.y };
  escapeGame.ai.chooseMove = () => ({ x: exitCell.x, y: exitCell.y });
  const escapeResult = escapeGame.moveFugitive();
  check(escapeResult.kind === 'escape' && escapeGame.outcome === 'fugitive', 'reaching the exit wins for the fugitive');

  // A fugitive stepping onto the hunter is captured.
  const captureGame = new Game(makeRng(9), AI.NORMAL);
  captureGame.newGame();
  captureGame.state = 'fugitive';
  captureGame.hunter = { x: 3, y: 2 };
  captureGame.ai.chooseMove = () => ({ x: 3, y: 2 });
  captureGame.fugitive = { x: 3, y: 3 };
  const captureResult = captureGame.moveFugitive();
  check(captureResult.kind === 'capture' && captureGame.outcome === 'hunter', 'sharing a tile is a capture');
}

// --------------------------------------------------------- full battles ---
section('Simulated battles');
{
  const names = ['Easy', 'Normal', 'Hard', 'Expert'];
  let resolved = 0;
  let total = 0;

  for (const difficulty of [AI.EASY, AI.NORMAL, AI.HARD, AI.EXPERT]) {
    let captures = 0;
    let escapes = 0;
    let longGames = 0;
    let illegal = 0;

    for (let seed = 0; seed < 25; seed++) {
      const game = new Game(makeRng(seed * 104729 + 7), difficulty);
      game.newGame();
      let guard = 0;

      while (game.state !== 'over' && guard < 300) {
        guard += 1;
        if (game.state === 'player') {
          const next = Pathfinding.nextStep(game.grid, game.hunter, game.fugitive);
          const direction = [next.x - game.hunter.x, next.y - game.hunter.y];
          const result = game.move(direction);
          if (result.kind === 'blocked') {
            illegal += 1;
            break;
          }
        } else {
          const before = { ...game.fugitive };
          const options = game.ai._legalMoves(game.grid, game.hunter, game.fugitive);
          game.moveFugitive();
          if (game.state !== 'over' && options.length > 0 && same(before, game.fugitive)) illegal += 1;
        }
      }

      total += 1;
      if (game.state === 'over') resolved += 1;
      else longGames += 1;
      if (game.outcome === 'hunter') captures += 1;
      else if (game.outcome === 'fugitive') escapes += 1;
    }

    check(illegal === 0, `${names[difficulty]}: no illegal moves or frozen AI (captures=${captures}, escapes=${escapes}, long=${longGames})`);
  }

  // The proxy hunter in this test is a naive chaser, so a few equal-speed
  // dances are expected; a human breaks them by cutting the fugitive off.
  check(resolved / total >= 0.7, `most chases resolve within 300 turns (${resolved}/${total})`);
}

// ------------------------------------------------------------ behaviour ---
section('Desperation');
{
  const grid = new Grid(11, 7);
  const exitCell = { x: 9, y: 5 };
  grid.setTile(exitCell.x, exitCell.y, TILE.EXIT);
  const hunter = { x: 1, y: 5 };
  const fugitive = { x: 1, y: 1 };
  const exitField = Pathfinding.distanceField(grid, [exitCell], [hunter]);
  const before = exitField.get(fugitive.y * grid.w + fugitive.x);

  const ai = new FugitiveAI(AI.EXPERT);
  const move = ai.chooseMove(grid, hunter, fugitive, 120);
  const after = exitField.get(move.y * grid.w + move.x);
  check(after < before, 'a desperate Expert steps towards the exit');
}

// -------------------------------------------------------------------- out ---
console.log(`\n${failures === 0 ? `ALL ${checks} CHECKS PASSED` : `${failures} of ${checks} CHECKS FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
