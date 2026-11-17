'use strict';

/**
 * Logic checks for the single-file browser build.
 *
 * Run with: node tests/web_smoke_test.js
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
  Grid, Pathfinding, MapGenerator, FugitiveAI, HunterAI, Game,
  AI, TILE, same, manhattan, chebyshev, makeRng
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

function settings(side, hunters, fugitives, walls, difficulty = AI.NORMAL, exits = 1, limit = 0) {
  return { side, hunters, fugitives, exits, limit, walls, difficulty };
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
    settings('hunters', 1, 1, 0),
    settings('hunters', 1, 1, 20),
    settings('hunters', 1, 1, 40),
    settings('hunters', 2, 2, 40),
    settings('hunters', 2, 2, 40, AI.NORMAL, 3),
    settings('hunters', 3, 3, 45),
    settings('hunters', 3, 3, 50, AI.HARD, 5),
    settings('hunters', 5, 5, 60),
    settings('hunters', 1, 1, 40, AI.NORMAL, 0, 60),
    settings('fugitives', 2, 4, 30, AI.NORMAL, 2)
  ];
  let broken = 0;
  let generated = 0;
  let openAt0 = 0;
  let openAt60 = 0;

  for (const config of configs) {
    for (let seed = 0; seed < 25; seed++) {
      const grid = new Grid(15, 15);
      const spawns = MapGenerator.generate(grid, makeRng(seed * 7919 + 13), config);
      generated += 1;

      const open = grid.walkableCells().length;
      if (config.walls === 0) openAt0 += open;
      if (config.walls === 60) openAt60 += open;

      const actors = [...spawns.cops, ...spawns.fugitives];
      const unique = new Set(actors.map((cell) => `${cell.x},${cell.y}`));
      const uniqueExits = new Set(grid.exits.map((cell) => `${cell.x},${cell.y}`));
      let valid =
        spawns.cops.length === config.hunters &&
        spawns.fugitives.length === config.fugitives &&
        unique.size === actors.length &&
        grid.exits.length === config.exits &&
        uniqueExits.size === config.exits;

      for (const actor of actors) {
        if (!valid) break;
        if (!grid.isWalkable(actor.x, actor.y)) valid = false;
        if (grid.exits.some((exit) => same(actor, exit))) valid = false;
      }

      if (valid) {
        for (const exit of grid.exits) {
          if (!Pathfinding.isReachable(grid, actors[0], exit)) valid = false;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!grid.isWalkable(exit.x + dx, exit.y + dy)) valid = false;
            }
          }
        }
      }

      if (!valid) broken += 1;
    }
  }

  check(broken === 0, `${generated} maps spawn the requested actors on a connected board`);
  check(openAt0 / 25 === 169, '0% walls leaves an open interior');
  check(openAt0 / 25 > openAt60 / 25, 'more walls means fewer open cells');
}

// -------------------------------------------------------------------- AI ---
section('Fugitive AI (adversarial search)');
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
  const fugitives = [
    { id: 'f0', x: 2, y: 3, status: 'active' },
    { id: 'f1', x: 6, y: 3, status: 'active' }
  ];

  for (const difficulty of [AI.EASY, AI.NORMAL, AI.HARD, AI.EXPERT, AI.MAX]) {
    const ai = new FugitiveAI(difficulty);
    const move = ai.chooseMove(grid, cops, fugitives, 0);
    const unit = move ? fugitives[move.unit] : null;
    check(move !== null && unit, `fugitive difficulty ${difficulty} picks a unit and a move`);
    check(move && grid.isWalkable(move.x, move.y), `fugitive difficulty ${difficulty} returns a walkable tile`);
    check(move && unit && manhattan(move, unit) === 1, `fugitive difficulty ${difficulty} moves exactly one tile`);
    check(move && !cops.some((cop) => same(cop, move)), `fugitive difficulty ${difficulty} never steps onto a hunter`);
    check(move && !fugitives.some((other, index) =>
      index !== move.unit && other.status === 'active' && same(other, move)),
      `fugitive difficulty ${difficulty} never stacks on another fugitive`);
  }

  const expert = new FugitiveAI(AI.EXPERT);
  const expertMove = expert.chooseMove(grid, cops, [fugitives[0]], 0);
  const expertUnit = expertMove ? fugitives[0] : null;
  check(expertMove && expertUnit &&
    cops.every((cop) => Math.max(Math.abs(expertMove.x - cop.x), Math.abs(expertMove.y - cop.y)) > 1),
    'Expert keeps the chosen fugitive out of every hunter\'s reach');

  const escapeGrid = new Grid(9, 9);
  escapeGrid.setTile(4, 4, TILE.EXIT);
  const escaper = new FugitiveAI(AI.EXPERT);
  const escapeMove = escaper.chooseMove(
    escapeGrid,
    [{ x: 1, y: 1 }],
    [{ id: 'f0', x: 4, y: 3, status: 'active' }],
    0
  );
  check(escapeMove && escapeGrid.isExit(escapeMove.x, escapeMove.y), 'the search takes a winning exit move');
}

section('Hunter AI (adversarial search)');
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
  const fugitive = { id: 'f0', x: 3, y: 3, status: 'active' };
  const ai = new HunterAI(AI.NORMAL);
  const move = ai.chooseMove(grid, [hunter], [fugitive], 0);
  check(move && move.unit === 0 && same(move, fugitive), 'the search captures an adjacent fugitive');

  const easy = new HunterAI(AI.EASY);
  const easyMove = easy.chooseMove(grid, [hunter], [fugitive], 0);
  const easyCop = easyMove ? [hunter][easyMove.unit] : null;
  check(easyMove && grid.isWalkable(easyMove.x, easyMove.y), 'an easy hunter returns a walkable tile');
  check(easyMove && easyCop && manhattan(easyMove, easyCop) === 1, 'an easy hunter moves exactly one tile');
}

// --------------------------------------------------------- game state ----
section('Game state machine');
{
  const game = new Game(makeRng(42), settings('hunters', 3, 2, 40));
  game.newGame();
  check(game.cops.length === 3 && game.fugitives.length === 2, 'the requested actor counts are built');
  check(game.phase === 'hunters' && game.round === 1, 'a new game starts on the hunter phase');
  check(game.selectedUnit() !== null, 'a movable hunter is selected automatically');
  check(game.canAnyHunterMove(), 'a hunter can move');

  // The player can pick any hunter, not a forced rotation.
  const first = game.selectedUnit();
  const alternate = game.cops.find((cop) => cop !== first && game.copMoves(cop).length > 0);
  if (alternate) {
    game.selectUnit(alternate.id);
    check(game.selectedUnit() === alternate, 'the player can choose a different hunter');
  } else {
    check(true, 'the player can choose a different hunter (single option)');
  }

  const chosen = game.selectedUnit();
  const before = game.cops.map((cop) => ({ x: cop.x, y: cop.y }));
  const target = game.copMoves(chosen)[0];
  game.moveSelectedCop(target.x - chosen.x, target.y - chosen.y);
  check(game.phase === 'fugitives', 'the fugitive phase follows the hunter move');
  const moved = game.cops.filter((cop, index) => !same(cop, before[index]));
  check(moved.length === 1 && same(moved[0], chosen), 'only the chosen hunter moves');

  // The AI fugitives move one unit, then the round advances.
  game.aiFugitiveStep();
  check(game.phase === 'hunters' && game.round === 2, 'one AI fugitive move ends the round');
  check(game.selectedUnit() !== null, 'a hunter is selected for the new round');

  // The player can choose a different hunter next round.
  const nextHunter = game.cops.find((cop) => game.copMoves(cop).length > 0);
  if (nextHunter) {
    game.selectUnit(nextHunter.id);
    check(game.selectedUnit() === nextHunter, 'the next round can use another hunter');
  }

  // Playing as the fugitives.
  const side = new Game(makeRng(9), settings('fugitives', 2, 2, 0, AI.EASY));
  side.newGame();
  check(side.playerSide === 'fugitives' && side.phase === 'hunters', 'the player can take the fugitive side');
  side.aiHunterStep();
  check(side.phase === 'fugitives', 'the AI moves one hunter, then the player acts');
  check(side.selectedUnit() !== null, 'a fugitive is selected automatically');
  const chosenFugitive = side.selectedUnit();
  const otherFugitive = side.activeFugitives().find((fugitive) => fugitive !== chosenFugitive);
  if (otherFugitive && side.fugitiveMoves(otherFugitive).length > 0) {
    side.selectUnit(otherFugitive.id);
    check(side.selectedUnit() === otherFugitive, 'the player can choose a different fugitive');
  }
  const activeFugitive = side.selectedUnit();
  const fugitiveTarget = side.fugitiveMoves(activeFugitive)[0];
  side.moveSelectedFugitive(fugitiveTarget.x - activeFugitive.x, fugitiveTarget.y - activeFugitive.y);
  check(side.phase === 'hunters' && side.round === 2, 'one fugitive move ends the round');

  // Capture ends a one-fugitive hunt immediately.
  const capture = new Game(makeRng(3), settings('hunters', 1, 1, 40));
  capture.newGame();
  const prey = capture.fugitives[0];
  const hunter = capture.cops[0];
  hunter.x = prey.x + 1;
  hunter.y = prey.y;
  capture.selectUnit(hunter.id);
  const captureResult = capture.moveSelectedCop(-1, 0);
  check(captureResult.kind === 'capture', 'stepping onto a fugitive captures it');
  check(capture.outcome === 'hunters' && capture.playerWon === true, 'catching the last fugitive wins for the hunters');

  // An escape ends the hunt immediately and wins for the fugitives.
  const escape = new Game(makeRng(5), settings('hunters', 1, 1, 40));
  escape.newGame();
  const exitCell = escape.grid.exits[0];
  escape.fugitives[0].x = exitCell.x;
  escape.fugitives[0].y = exitCell.y - 1;
  escape.grid.setTile(exitCell.x, exitCell.y - 1, TILE.FLOOR);
  escape.fugitiveAI.chooseMove = () => ({ unit: 0, x: exitCell.x, y: exitCell.y });
  escape.beginFugitivePhase();
  const escapeResult = escape.aiFugitiveStep();
  check(escapeResult.kind === 'escaped' && escape.outcome === 'fugitives', 'reaching the exit wins for the fugitive');
  check(escape.playerWon === false, 'a hunter player loses when a fugitive escapes');

  // The same escape is a win when the player controls the fugitive.
  const reverse = new Game(makeRng(7), settings('fugitives', 1, 1, 0, AI.EASY));
  reverse.newGame();
  const reverseExit = reverse.grid.exits[0];
  reverse.fugitives[0].x = reverseExit.x;
  reverse.fugitives[0].y = reverseExit.y - 1;
  reverse.grid.setTile(reverseExit.x, reverseExit.y - 1, TILE.FLOOR);
  reverse.fugitiveAI.random = Math.random;
  reverse.hunterAI.random = Math.random;
  reverse.aiHunterStep();
  reverse.beginFugitivePhase();
  reverse.selectUnit(reverse.fugitives[0].id);
  reverse.moveSelectedFugitive(0, 1);
  check(reverse.outcome === 'fugitives' && reverse.playerWon === true, 'the fugitive player wins by escaping');

  // An AI hunter capture is a loss for the fugitive player.
  const caught = new Game(makeRng(11), settings('fugitives', 1, 1, 40));
  caught.newGame();
  const victim = caught.fugitives[0];
  const chaser = caught.cops[0];
  chaser.x = victim.x + 1;
  chaser.y = victim.y;
  caught.aiHunterStep();
  check(caught.outcome === 'hunters' && caught.playerWon === false, 'the fugitive player loses when the hunter catches it');

  // No exits is legal, but the hunt must then end on the clock.
  const noExit = new Game(makeRng(17), settings('hunters', 1, 1, 40, AI.NORMAL, 0, 0));
  noExit.newGame();
  check(noExit.grid.exits.length === 0 && noExit.hasExits === false, 'zero exits leaves no exit tile');
  check(noExit.roundLimit === 60, 'a no-exit hunt gets the default 60-round limit');
  noExit.skipHunterPhase();
  noExit.skipFugitivePhase();
  check(noExit.phase !== 'over' && noExit.endReason === null, 'the no-exit hunt continues before the limit');

  const noExitTimed = new Game(makeRng(23), settings('hunters', 1, 1, 40, AI.NORMAL, 0, 1));
  noExitTimed.newGame();
  check(noExitTimed.roundLimit === 1, 'a no-exit hunt keeps an explicit limit');
  noExitTimed.skipHunterPhase();
  noExitTimed.skipFugitivePhase();
  check(noExitTimed.phase === 'over' && noExitTimed.outcome === 'fugitives' && noExitTimed.endReason === 'timeout',
    'a no-exit hunt ends in a timeout win for the fugitives');

  const timed = new Game(makeRng(19), settings('hunters', 1, 1, 40, AI.EASY, 2, 1));
  timed.newGame();
  check(timed.roundLimit === 1, 'a round limit is stored on the game');
  timed.skipHunterPhase();
  timed.skipFugitivePhase();
  check(timed.phase === 'over' && timed.endReason === 'timeout', 'the round limit ends the hunt after the fugitives act');
  check(timed.outcome === 'fugitives' && timed.playerWon === false, 'a hunter player loses on a timeout');
}

// --------------------------------------------------------- full battles ---
section('Simulated battles');
{
  const configs = [
    settings('hunters', 1, 1, 40),
    settings('hunters', 2, 2, 40),
    settings('hunters', 3, 2, 45, AI.NORMAL, 2),
    settings('fugitives', 1, 1, 40),
    settings('fugitives', 2, 2, 40),
    settings('fugitives', 1, 3, 30)
  ];
  let resolved = 0;
  let total = 0;
  let longGames = 0;

  for (const config of configs) {
    let broken = 0;
    let configResolved = 0;
    let configLong = 0;

    for (let seed = 0; seed < 10; seed++) {
      const game = new Game(makeRng(seed * 104729 + 7), config);
      game.newGame();
      let guard = 0;

      while (game.phase !== 'over' && guard < 1500) {
        guard += 1;

        if (game.phase === 'hunters') {
          if (config.side === 'fugitives') {
            game.aiHunterStep();
            continue;
          }
          if (!game.canAnyHunterMove()) {
            game.skipHunterPhase();
            continue;
          }
          const movable = game.cops.filter((cop) => game.copMoves(cop).length > 0);
          const hunter = movable.sort((a, b) => {
            const fa = game.activeFugitives().reduce((best, f) => Math.min(best, manhattan(a, f)), Infinity);
            const fb = game.activeFugitives().reduce((best, f) => Math.min(best, manhattan(b, f)), Infinity);
            return fa - fb;
          })[0];
          game.selectUnit(hunter.id);
          const fugitive = game.activeFugitives()
            .slice()
            .sort((a, b) => manhattan(a, hunter) - manhattan(b, hunter))[0];
          const otherCops = game.cops.filter((cop) => cop !== hunter);
          const path = fugitive ? Pathfinding.findPath(game.grid, hunter, fugitive, otherCops) : [];
          const target = path.length > 0 ? path[0] : game.copMoves(hunter)[0];
          if (target) game.moveSelectedCop(target.x - hunter.x, target.y - hunter.y);
          else game.skipHunterPhase();
          continue;
        }

        if (config.side === 'fugitives') {
          if (!game.canAnyFugitiveMove()) {
            game.skipFugitivePhase();
            continue;
          }
          const movable = game.activeFugitives().filter((fugitive) => game.fugitiveMoves(fugitive).length > 0);
          const exit = game.grid.exits[0];
          const fugitive = movable.sort((a, b) => {
            const da = Math.min(...game.grid.exits.map((cell) => manhattan(a, cell)));
            const db = Math.min(...game.grid.exits.map((cell) => manhattan(b, cell)));
            return da - db;
          })[0];
          game.selectUnit(fugitive.id);
          const others = game.activeFugitives().filter((other) => other !== fugitive);
          const path = Pathfinding.findPath(game.grid, fugitive, exit, [...game.cops, ...others]);
          const target = path.length > 0 ? path[0] : game.fugitiveMoves(fugitive)[0];
          if (target) game.moveSelectedFugitive(target.x - fugitive.x, target.y - fugitive.y);
          else game.skipFugitivePhase();
          continue;
        }

        game.aiFugitiveStep();
      }

      total += 1;
      const expectedWin = (config.side === 'hunters') === (game.outcome === 'hunters');
      const actors = [...game.cops, ...game.activeFugitives()];
      const unique = new Set(actors.map((cell) => `${cell.x},${cell.y}`)).size === actors.length;
      const walkable = actors.every((cell) => game.grid.isWalkable(cell.x, cell.y));
      const consistent = game.caught + game.escaped <= game.totalFugitives;

      let valid = unique && walkable && consistent;
      if (game.phase === 'over') {
        valid = valid &&
          (game.outcome === 'hunters' || game.outcome === 'fugitives') &&
          game.playerWon === expectedWin &&
          (game.outcome === 'hunters'
            ? game.caught === game.totalFugitives && game.escaped === 0
            : game.escaped >= 1);
        if (valid) configResolved += 1;
      } else {
        valid = valid && game.activeFugitives().length > 0 && game.playerWon === null;
        if (valid) configLong += 1;
      }

      if (!valid) broken += 1;
    }

    resolved += configResolved;
    longGames += configLong;
    check(broken === 0,
      `${config.side} ${config.hunters}v${config.fugitives} at ${config.walls}% stays consistent (${configResolved} resolved, ${configLong} long)`);
  }

  check(resolved >= total * 0.7, `most simulated hunts reach a result (${resolved}/${total}, ${longGames} still running)`);
}

// -------------------------------------------------------------------- out ---
console.log(`\n${failures === 0 ? `ALL ${checks} CHECKS PASSED` : `${failures} of ${checks} CHECKS FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
