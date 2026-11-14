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
    settings('fugitives', 2, 4, 30, AI.NORMAL, 2),
    settings('hunters', 1, 1, 40, AI.NORMAL, 0, 60),
    settings('hunters', 3, 2, 0, AI.NORMAL, 0, 60),
    settings('fugitives', 2, 2, 45, AI.NORMAL, 0, 40)
  ];
  let broken = 0;
  let generated = 0;
  let openAt0 = 0;
  let countAt0 = 0;
  let openAt60 = 0;
  let countAt60 = 0;

  for (const config of configs) {
    for (let seed = 0; seed < 25; seed++) {
      const grid = new Grid(15, 15);
      const spawns = MapGenerator.generate(grid, makeRng(seed * 7919 + 13), config);
      generated += 1;

      const open = grid.walkableCells().length;
      if (config.walls === 0) { openAt0 += open; countAt0 += 1; }
      if (config.walls === 60) { openAt60 += open; countAt60 += 1; }

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
  check(openAt0 / countAt0 === 169, '0% walls leaves an open interior');
  check(openAt0 / countAt0 > openAt60 / countAt60, 'more walls means fewer open cells');
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

  for (const difficulty of [AI.EASY, AI.NORMAL, AI.HARD, AI.EXPERT, AI.MAX]) {
    const ai = new FugitiveAI(difficulty);
    const move = ai.chooseMove(grid, cops, fugitive, others, 0);
    check(grid.isWalkable(move.x, move.y), `fugitive difficulty ${difficulty} returns a walkable tile`);
    check(manhattan(move, fugitive) === 1, `fugitive difficulty ${difficulty} moves exactly one tile`);
    check(!cops.some((cop) => same(cop, move)), `fugitive difficulty ${difficulty} never steps onto a hunter`);
    check(!others.some((other) => same(other, move)), `fugitive difficulty ${difficulty} never stacks on another fugitive`);
  }

  const expert = new FugitiveAI(AI.EXPERT);
  const expertMove = expert.chooseMove(grid, cops, fugitive, [], 0);
  check(cops.every((cop) => Math.max(Math.abs(expertMove.x - cop.x), Math.abs(expertMove.y - cop.y)) > 1),
    'Expert keeps out of every hunter\'s reach');
}

section('Hunter AI');
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
  const fugitive = { x: 3, y: 3, status: 'active' };
  const ai = new HunterAI(AI.NORMAL);
  const move = ai.chooseMove(grid, hunter, [fugitive], [hunter]);
  check(same(move, fugitive), 'a normal hunter steps onto an adjacent fugitive');

  const easy = new HunterAI(AI.EASY);
  const easyMove = easy.chooseMove(grid, hunter, [fugitive], [hunter]);
  check(grid.isWalkable(easyMove.x, easyMove.y), 'an easy hunter returns a walkable tile');
  check(manhattan(easyMove, hunter) === 1, 'an easy hunter moves exactly one tile');

  const blocker = { x: 3, y: 3 };
  const blockedAI = new HunterAI(AI.EXPERT);
  const blockedMove = blockedAI.chooseMove(grid, hunter, [{ x: 5, y: 3, status: 'active' }], [hunter, blocker]);
  check(!same(blockedMove, blocker), 'a hunter never steps onto another hunter');
}

// --------------------------------------------------------- game state ----
section('Game state machine');
{
  // Hunters are forced to move in rotation; no selection.
  const game = new Game(makeRng(42), settings('hunters', 3, 2, 40));
  game.newGame();
  check(game.cops.length === 3 && game.fugitives.length === 2, 'the requested actor counts are built');
  check(game.phase === 'hunters' && game.round === 1, 'a new game starts on the hunter phase');
  check(game.activeHunterIndex === 0, 'the first hunter starts');

  const before = game.cops.map((cop) => ({ x: cop.x, y: cop.y }));
  const active = game.activeHunter();
  const target = game.hunterTargets(active)[0];
  if (target) game.moveActiveHunter(target.x - active.x, target.y - active.y);
  else game.skipHunterTurn();

  const movedOthers = game.cops.filter((cop, index) => !same(cop, before[index]));
  check(movedOthers.length <= 1 && (movedOthers.length === 0 || same(movedOthers[0], active)),
    'only the active hunter moves');
  check(game.phase === 'fugitives', 'the fugitive phase follows the hunter move');
  check(game.activeHunterIndex === 1, 'the turn passes to the next hunter');

  game.endFugitivePhase();
  check(game.phase === 'hunters' && game.round === 2, 'a new round starts after the fugitives');
  check(game.activeHunterIndex === 1, 'the next round uses the second hunter');

  const second = game.activeHunter();
  const secondTarget = game.hunterTargets(second)[0];
  if (secondTarget) game.moveActiveHunter(secondTarget.x - second.x, secondTarget.y - second.y);
  else game.skipHunterTurn();
  check(game.activeHunterIndex === 2, 'the rotation continues to the third hunter');

  // Playing as the fugitives: the AI moves the hunters in rotation.
  const side = new Game(makeRng(9), settings('fugitives', 2, 2, 0, AI.EASY));
  side.newGame();
  check(side.playerSide === 'fugitives' && side.phase === 'hunters', 'the player can take the fugitive side');
  side.aiHunterStep();
  check(side.phase === 'fugitives', 'the AI hunter acts, then the player moves fugitives');
  check(side.activeHunterIndex === 1, 'the AI hunters rotate too');
  const selected = side.fugitiveById(side.selectedFugitiveId);
  check(selected !== null, 'a fugitive is selected for the player');
  const fugitiveTarget = side.fugitiveTargets(selected)[0];
  if (fugitiveTarget) side.moveSelectedFugitive(fugitiveTarget.x - selected.x, fugitiveTarget.y - selected.y);
  check(selected.movedThisPhase, 'the player fugitive moves one tile');

  // Capture ends a one-fugitive hunt immediately.
  const capture = new Game(makeRng(3), settings('hunters', 1, 1, 40));
  capture.newGame();
  const prey = capture.fugitives[0];
  const hunter = capture.activeHunter();
  hunter.x = prey.x + 1;
  hunter.y = prey.y;
  const captureResult = capture.moveActiveHunter(-1, 0);
  check(captureResult.kind === 'capture', 'stepping onto a fugitive captures it');
  check(capture.outcome === 'hunters' && capture.playerWon === true, 'catching the last fugitive wins for the hunters');

  // An escape ends the hunt immediately and wins for the fugitives.
  const escape = new Game(makeRng(5), settings('hunters', 1, 1, 40));
  escape.newGame();
  const exitCell = escape.grid.exits[0];
  escape.fugitives[0].x = exitCell.x;
  escape.fugitives[0].y = exitCell.y - 1;
  escape.grid.setTile(exitCell.x, exitCell.y - 1, TILE.FLOOR);
  escape.aiList[0].chooseMove = () => ({ x: exitCell.x, y: exitCell.y });
  escape.beginFugitivePhase();
  const escapeResult = escape.stepFugitive();
  check(escapeResult.kind === 'escaped' && escape.outcome === 'fugitives', 'reaching the exit wins for the fugitive');
  check(escape.playerWon === false, 'a hunter player loses when a fugitive escapes');

  // With several exits, any one of them wins for the fugitives.
  const multi = new Game(makeRng(13), settings('hunters', 1, 2, 40, AI.NORMAL, 3));
  multi.newGame();
  check(multi.grid.exits.length === 3, 'three exits are placed on the board');
  const farExit = multi.grid.exits[multi.grid.exits.length - 1];
  multi.fugitives[0].x = farExit.x;
  multi.fugitives[0].y = farExit.y - 1;
  multi.grid.setTile(farExit.x, farExit.y - 1, TILE.FLOOR);
  multi.aiList[0].chooseMove = () => ({ x: farExit.x, y: farExit.y });
  multi.beginFugitivePhase();
  const multiResult = multi.stepFugitive();
  check(multiResult.kind === 'escaped' && multi.outcome === 'fugitives', 'any exit wins for the fugitives');

  // The same escape is a win when the player controls the fugitive.
  const reverse = new Game(makeRng(7), settings('fugitives', 1, 1, 0, AI.EASY));
  reverse.newGame();
  const reverseExit = reverse.grid.exits[0];
  reverse.fugitives[0].x = reverseExit.x;
  reverse.fugitives[0].y = reverseExit.y - 1;
  reverse.grid.setTile(reverseExit.x, reverseExit.y - 1, TILE.FLOOR);
  reverse.beginFugitivePhase();
  reverse.selectedFugitiveId = reverse.fugitives[0].id;
  reverse.moveSelectedFugitive(0, 1);
  check(reverse.outcome === 'fugitives' && reverse.playerWon === true, 'the fugitive player wins by escaping');

  // An AI hunter capture is a loss for the fugitive player.
  const caught = new Game(makeRng(11), settings('fugitives', 1, 1, 40));
  caught.newGame();
  const victim = caught.fugitives[0];
  const chaser = caught.activeHunter();
  chaser.x = victim.x + 1;
  chaser.y = victim.y;
  caught.aiHunterStep();
  check(caught.outcome === 'hunters' && caught.playerWon === false, 'the fugitive player loses when the hunter catches it');
}

// ------------------------------------------------- no exits / limit ----
section('No exits and round limits');
{
  // A zero-exit request really places no exit tiles.
  let broken = 0;
  for (let seed = 0; seed < 15; seed++) {
    const grid = new Grid(15, 15);
    const config = settings('hunters', 2, 2, 40, AI.NORMAL, 0, 60);
    const spawns = MapGenerator.generate(grid, makeRng(seed * 6151 + 3), config);
    if (grid.exits.length !== 0) broken += 1;
    if (spawns.cops.length !== 2 || spawns.fugitives.length !== 2) broken += 1;
  }
  check(broken === 0, 'a zero-exit board has no exit tiles and still spawns every actor');

  // A no-exit hunt cannot run open-ended, so it gets the default limit.
  const forced = new Game(makeRng(21), settings('hunters', 1, 1, 40, AI.NORMAL, 0, 0));
  forced.newGame();
  check(forced.grid.exits.length === 0, 'a no-exit hunt really has no exit tiles');
  check(forced.roundLimit === 60, 'a no-exit hunt gets the default round limit');

  // The clock runs out at the end of the allowed round and the fugitives win.
  const timed = new Game(makeRng(23), settings('hunters', 2, 2, 40, AI.NORMAL, 0, 3));
  timed.newGame();
  for (let round = 0; round < 10 && timed.phase !== 'over'; round++) {
    timed.beginHunterPhase();
    timed.beginFugitivePhase();
    timed.endFugitivePhase();
  }
  check(timed.endReason === 'timeout' && timed.outcome === 'fugitives', 'running out of rounds wins for the fugitives');
  check(timed.round === 3 && timed.escaped === 0, 'a timeout is decided on the clock, not by an escape');
  check(timed.playerWon === false, 'a hunter player loses when the round limit runs out');

  // The same timeout is a win for the player who controls the fugitives.
  const survived = new Game(makeRng(29), settings('fugitives', 1, 1, 40, AI.NORMAL, 0, 2));
  survived.newGame();
  for (let round = 0; round < 10 && survived.phase !== 'over'; round++) {
    survived.beginHunterPhase();
    survived.beginFugitivePhase();
    survived.endFugitivePhase();
  }
  check(survived.endReason === 'timeout' && survived.playerWon === true, 'a fugitive player wins by surviving the limit');

  // Catching on the last allowed round still beats the clock.
  const lastRound = new Game(makeRng(31), settings('hunters', 1, 1, 40, AI.NORMAL, 0, 2));
  lastRound.newGame();
  const prey = lastRound.fugitives[0];
  const chaser = lastRound.activeHunter();
  const dx = prey.x < lastRound.grid.w / 2 ? 1 : -1;
  lastRound.grid.setTile(prey.x + dx, prey.y, TILE.FLOOR);
  chaser.x = prey.x + dx;
  chaser.y = prey.y;
  lastRound.round = lastRound.roundLimit;
  const lastCatch = lastRound.moveActiveHunter(-dx, 0);
  check(lastCatch.kind === 'capture' && lastRound.outcome === 'hunters' && lastRound.endReason === 'caught',
    'a catch on the final round still wins for the hunters');

  // Without a limit the clock never ends the hunt.
  const openEnded = new Game(makeRng(37), settings('hunters', 1, 1, 40, AI.NORMAL, 1, 0));
  openEnded.newGame();
  openEnded.phase = 'fugitives';
  openEnded.round = 500;
  check(openEnded.endFugitivePhase() === false && openEnded.round === 501,
    'a hunt without a limit never times out');

  // The AIs still work when there is no exit to aim at.
  const grid = new Grid();
  grid.loadLayout([
    '#########',
    '#.......#',
    '#.......#',
    '#F..H...#',
    '#.......#',
    '#########'
  ]);
  check(grid.exits.length === 0, 'the no-exit test layout has no exit');
  const cops = [{ x: 4, y: 3 }];
  const fugitive = { x: 1, y: 3 };
  for (const difficulty of [AI.NORMAL, AI.HARD, AI.EXPERT, AI.MAX]) {
    const move = new FugitiveAI(difficulty).chooseMove(grid, cops, fugitive, [], 0);
    check(manhattan(move, fugitive) === 1 && grid.isWalkable(move.x, move.y),
      `no-exit fugitive AI ${difficulty} takes a legal step`);
    check(!same(move, cops[0]), `no-exit fugitive AI ${difficulty} never steps onto a hunter`);
    check(manhattan(move, cops[0]) > manhattan(fugitive, cops[0]),
      `no-exit fugitive AI ${difficulty} steps away from the hunter`);
  }
  const chase = new HunterAI(AI.EXPERT).chooseMove(grid, cops[0], [{ x: 5, y: 3, status: 'active' }], cops);
  check(grid.isWalkable(chase.x, chase.y) && !same(chase, cops[0]), 'an expert hunter works on a board with no exits');
}

// ------------------------------------------------------------------ Max ---
section('Max AI');
{
  // Max hunter takes a free capture.
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
  const prey = { x: 3, y: 3, status: 'active' };
  const capture = new HunterAI(AI.MAX).chooseMove(grid, hunter, [prey], [hunter]);
  check(same(capture, prey), 'a Max hunter steps onto an adjacent fugitive');

  // A no-exit Max hunter still returns a legal step.
  const closed = new Grid();
  closed.loadLayout([
    '#########',
    '#.......#',
    '#.......#',
    '#F..H...#',
    '#.......#',
    '#########'
  ]);
  const closedHunter = new HunterAI(AI.MAX)
    .chooseMove(closed, { x: 4, y: 3 }, [{ x: 1, y: 3, status: 'active' }], [{ x: 4, y: 3 }]);
  check(closed.isWalkable(closedHunter.x, closedHunter.y), 'a Max hunter works on a board with no exits');

  // Strength: a scripted runner heads straight for the exit against both
  // hunter tiers; Max has to catch it more often without giving up escapes.
  function scriptedHunt(difficulty, seed) {
    const board = new Grid(15, 15);
    const config = settings('hunters', 1, 1, 40, AI.NORMAL, 1, 0);
    const spawns = MapGenerator.generate(board, makeRng(seed * 7919 + 3), config);
    const cop = { ...spawns.cops[0] };
    const fug = { ...spawns.fugitives[0] };
    const ai = new HunterAI(difficulty);
    ai.random = makeRng(seed + 1);
    for (let round = 1; round <= 40; round++) {
      const move = ai.chooseMove(board, cop, [{ ...fug, status: 'active' }], [cop]);
      if (move && manhattan(move, cop) === 1) { cop.x = move.x; cop.y = move.y; }
      if (same(cop, fug)) return 'caught';
      const exit = board.exits[0];
      const route = Pathfinding.findPath(board, fug, exit, [cop]);
      const step = route.length > 0
        ? route[0]
        : board.neighbors(fug.x, fug.y).find((cell) => !same(cell, cop));
      if (!step) return 'stuck';
      fug.x = step.x;
      fug.y = step.y;
      if (board.isExit(fug.x, fug.y)) return 'escaped';
    }
    return 'timeout';
  }

  // Strength: a scripted A* hunter chases both fugitive tiers; Max has to
  // escape at least as often and be caught no more often.
  function scriptedChase(difficulty, seed) {
    const board = new Grid(15, 15);
    const config = settings('hunters', 1, 1, 40, AI.NORMAL, 1, 0);
    const spawns = MapGenerator.generate(board, makeRng(seed * 7919 + 3), config);
    const cop = { ...spawns.cops[0] };
    const fug = { ...spawns.fugitives[0], status: 'active' };
    const ai = new FugitiveAI(difficulty);
    ai.random = makeRng(seed + 2);
    for (let round = 1; round <= 40; round++) {
      const path = Pathfinding.findPath(board, cop, fug, []);
      if (path.length > 0) { cop.x = path[0].x; cop.y = path[0].y; }
      if (same(cop, fug)) return 'caught';
      const move = ai.chooseMove(board, [cop], fug, [], round, 0);
      if (move && manhattan(move, fug) === 1) { fug.x = move.x; fug.y = move.y; }
      if (board.isExit(fug.x, fug.y)) return 'escaped';
    }
    return 'timeout';
  }

  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  const count = (games, result) => games.filter((game) => game === result).length;

  const expertHunt = seeds.map((seed) => scriptedHunt(AI.EXPERT, seed));
  const maxHunt = seeds.map((seed) => scriptedHunt(AI.MAX, seed));
  check(count(maxHunt, 'caught') > count(expertHunt, 'caught'),
    `Max hunter catches more runners than Expert (${count(maxHunt, 'caught')} vs ${count(expertHunt, 'caught')})`);
  check(count(maxHunt, 'escaped') <= count(expertHunt, 'escaped'),
    `Max hunter gives up no more escapes than Expert (${count(maxHunt, 'escaped')} vs ${count(expertHunt, 'escaped')})`);

  const expertFlee = seeds.map((seed) => scriptedChase(AI.EXPERT, seed));
  const maxFlee = seeds.map((seed) => scriptedChase(AI.MAX, seed));
  check(count(maxFlee, 'escaped') >= count(expertFlee, 'escaped'),
    `Max fugitive escapes at least as often as Expert (${count(maxFlee, 'escaped')} vs ${count(expertFlee, 'escaped')})`);
  check(count(maxFlee, 'caught') <= count(expertFlee, 'caught'),
    `Max fugitive is caught no more often than Expert (${count(maxFlee, 'caught')} vs ${count(expertFlee, 'caught')})`);

  // A full game with Max on both sides stays consistent and obeys the clock.
  const game = new Game(makeRng(101), settings('hunters', 2, 2, 40, AI.MAX, 1, 20));
  game.newGame();
  let guard = 0;
  while (game.phase !== 'over' && guard < 400) {
    guard += 1;
    if (game.phase === 'hunters') {
      if (!game.canActiveHunterMove()) {
        game.skipHunterTurn();
        continue;
      }
      const active = game.activeHunter();
      const target = game.hunterTargets(active)[0];
      game.moveActiveHunter(target.x - active.x, target.y - active.y);
      continue;
    }
    const step = game.stepFugitive();
    if (!step) game.endFugitivePhase();
  }
  check(game.phase === 'over', 'a Max hunt with a round limit always finishes');
  check(game.playerWon === ((game.playerSide === 'hunters') === (game.outcome === 'hunters')),
    'the Max hunt reports a consistent winner');
}

// --------------------------------------------------------- full battles ---
section('Simulated battles');
{
  const configs = [
    settings('hunters', 1, 1, 40),
    settings('hunters', 2, 2, 40),
    settings('hunters', 2, 2, 45, AI.NORMAL, 3),
    settings('hunters', 3, 2, 45),
    settings('fugitives', 1, 1, 40),
    settings('fugitives', 2, 2, 40),
    settings('fugitives', 1, 3, 30, AI.NORMAL, 2),
    settings('hunters', 1, 2, 40, AI.NORMAL, 0, 60),
    settings('hunters', 2, 1, 0, AI.NORMAL, 0, 40),
    settings('fugitives', 1, 2, 30, AI.NORMAL, 0, 60),
    settings('hunters', 2, 2, 40, AI.MAX),
    settings('fugitives', 1, 2, 40, AI.MAX, 3, 40)
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
          if (!game.canActiveHunterMove()) {
            game.skipHunterTurn();
            continue;
          }
          const hunter = game.activeHunter();
          const fugitive = game.activeFugitives()
            .slice()
            .sort((a, b) => manhattan(a, hunter) - manhattan(b, hunter))[0];
          const otherCops = game.cops.filter((cop) => cop !== hunter);
          const path = fugitive ? Pathfinding.findPath(game.grid, hunter, fugitive, otherCops) : [];
          const target = path.length > 0 ? path[0] : game.hunterTargets(hunter)[0];
          if (target) game.moveActiveHunter(target.x - hunter.x, target.y - hunter.y);
          else game.skipHunterTurn();
          continue;
        }

        if (config.side === 'fugitives') {
          if (!game.selectedFugitiveId) {
            game.endFugitivePhase();
            continue;
          }
          const fugitive = game.fugitiveById(game.selectedFugitiveId);
          const exit = game.grid.exits[0];
          const others = game.activeFugitives().filter((other) => other !== fugitive);
          let target = null;
          if (exit) {
            const path = Pathfinding.findPath(game.grid, fugitive, exit, [...game.cops, ...others]);
            target = path.length > 0 ? path[0] : game.fugitiveTargets(fugitive)[0];
          } else {
            const field = Pathfinding.distanceField(game.grid, game.cops);
            let best = -1;
            for (const cell of game.fugitiveTargets(fugitive)) {
              const distance = field.get(cell.y * game.grid.w + cell.x) ?? 0;
              if (distance > best) {
                best = distance;
                target = cell;
              }
            }
          }
          if (target) game.moveSelectedFugitive(target.x - fugitive.x, target.y - fugitive.y);
          else game.selectedFugitiveId = null;
          continue;
        }

        const step = game.stepFugitive();
        if (!step) game.endFugitivePhase();
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
            : game.escaped >= 1 || game.endReason === 'timeout');
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

  // Equal-speed pursuit can run forever when nobody makes a mistake, so a few
  // long games are legitimate; the engine must resolve most of them.
  check(resolved >= total * 0.7, `most simulated hunts reach a result (${resolved}/${total}, ${longGames} still running)`);
}

// -------------------------------------------------------------------- out ---
console.log(`\n${failures === 0 ? `ALL ${checks} CHECKS PASSED` : `${failures} of ${checks} CHECKS FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
