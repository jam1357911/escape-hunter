class_name FugitiveAI
extends RefCounted
## Picks the fugitive's move for each difficulty tier.
##
## Every tier sees the same information (grid, pathfinder, hunter, fugitive);
## what changes is how much of it is used:
##
## EASY   - random legal move.
## NORMAL - greedy one step towards the closest exit.
## HARD   - greedy towards the exit, but treats tiles near the hunter as
##          expensive, so it slides around the hunter instead of into it.
## EXPERT - A* route to the nearest exit, scored by a 3-turn pursuit
##          simulation, dead-end avoidance and the number of escape routes it
##          keeps available. It commits harder to the exit as the chase drags
##          on, so a hunt can never loop forever.

enum Difficulty { EASY, NORMAL, HARD, EXPERT }

const DIFFICULTY_NAMES := ["Easy", "Normal", "Hard", "Expert"]
const DIFFICULTY_HINTS := [
	"Walks in random directions.",
	"Runs straight for the nearest exit.",
	"Keeps clear of the hunter.",
	"Reads your next three moves.",
]

const PREDICTION_TURNS := 3
const UNREACHABLE := 1 << 20
const RECENT_MEMORY := 4

## Turns until each tier stops dodging and commits to the exit.
const URGENCY_TURNS := [8, 14, 20, 30]

var difficulty := Difficulty.NORMAL

## Tiles the fugitive recently left, used to break chase loops.
var _recent: Array[Vector2i] = []


func reset() -> void:
	_recent.clear()


func choose_move(
	grid: GridManager,
	pathfinder: PathfindingSystem,
	hunter: Vector2i,
	fugitive: Vector2i,
	turn := 0
) -> Vector2i:
	## Returns the tile the fugitive steps onto (its current tile if trapped).
	## [param turn] feeds the urgency term: the longer the chase lasts, the more
	## the AI commits to the exit instead of only dodging the hunter.
	var options := _legal_moves(grid, hunter, fugitive)
	if options.is_empty():
		return fugitive

	# The hunter's tile is treated as blocked: stepping onto it is capture.
	var blocked: Array[Vector2i] = [hunter]
	var exit_field := pathfinder.distances_from(grid, grid.exits, blocked)
	var urgency := clampf(float(turn) / float(URGENCY_TURNS[difficulty]), 0.0, 1.0)

	var choice: Vector2i
	match difficulty:
		Difficulty.EASY:
			choice = _random_move(options)
		Difficulty.HARD:
			choice = _cautious_move(options, exit_field, hunter, urgency)
		Difficulty.EXPERT:
			choice = _expert_move(grid, pathfinder, options, exit_field, hunter, fugitive, urgency)
		_:
			choice = _greedy_move(options, exit_field)

	_remember(fugitive)
	return choice


func _remember(cell: Vector2i) -> void:
	_recent.append(cell)
	if _recent.size() > RECENT_MEMORY:
		_recent.pop_front()


func _was_recent(cell: Vector2i) -> bool:
	return _recent.has(cell)


func _legal_moves(grid: GridManager, hunter: Vector2i, fugitive: Vector2i) -> Array[Vector2i]:
	var moves: Array[Vector2i] = []
	for neighbour in grid.walkable_neighbors(fugitive):
		if neighbour != hunter:
			moves.append(neighbour)
	return moves


func _random_move(options: Array[Vector2i]) -> Vector2i:
	return options[randi() % options.size()]


func _greedy_move(options: Array[Vector2i], exit_field: Dictionary) -> Vector2i:
	var best: Array[Vector2i] = []
	var best_score := INF
	for cell in options:
		var distance: int = exit_field.get(cell, UNREACHABLE)
		# A small penalty for tiles just left keeps a blocked fugitive from
		# pacing between the same two cells.
		var score := float(distance) + (1.5 if _was_recent(cell) else 0.0)
		if score < best_score:
			best_score = score
			best.clear()
			best.append(cell)
		elif score == best_score:
			best.append(cell)
	if best.is_empty():
		return options[0]
	return best[randi() % best.size()]


func _cautious_move(options: Array[Vector2i], exit_field: Dictionary, hunter: Vector2i, urgency: float) -> Vector2i:
	var threat_weight := lerpf(3.0, 0.0, urgency)
	var best := options[0]
	var best_score := INF
	for cell in options:
		var distance: int = exit_field.get(cell, UNREACHABLE)
		var score := float(distance) + float(_threat(cell, hunter)) * threat_weight
		if _was_recent(cell):
			score += 2.0 * (1.0 - urgency)
		if score < best_score:
			best_score = score
			best = cell
	return best


func _expert_move(
	grid: GridManager,
	pathfinder: PathfindingSystem,
	options: Array[Vector2i],
	exit_field: Dictionary,
	hunter: Vector2i,
	fugitive: Vector2i,
	urgency: float
) -> Vector2i:
	var best := fugitive
	var best_score := -INF
	for cell in options:
		var score := _score_expert_cell(grid, pathfinder, cell, exit_field, hunter, urgency)
		if score > best_score:
			best_score = score
			best = cell
	return best


func _score_expert_cell(
	grid: GridManager,
	pathfinder: PathfindingSystem,
	cell: Vector2i,
	exit_field: Dictionary,
	hunter: Vector2i,
	urgency: float
) -> float:
	if grid.is_exit(cell):
		return 10000.0

	# The route is a real A* plan with the hunter treated as blocked, so the
	# distance already accounts for walls and for the hunter's body.
	var route := _nearest_exit_path(grid, pathfinder, cell, hunter)
	if route.is_empty():
		return -10000.0
	var distance := route.size()
	var survival := _simulate_pursuit(grid, pathfinder, cell, hunter, exit_field)
	var openness := grid.walkable_neighbors(cell).size()
	var routes := _route_options(grid, exit_field, cell, hunter, distance)

	var score := 0.0
	score += float(survival) * lerpf(45.0, 0.0, urgency)
	score -= float(distance) * lerpf(7.0, 14.0, urgency)
	score += float(openness) * 6.0 * (1.0 - urgency)
	score += float(routes) * 9.0 * (1.0 - urgency)
	score -= float(_threat(cell, hunter)) * 2.0 * (1.0 - urgency)
	if openness <= 1:
		score -= 30.0 * (1.0 - urgency)
	if GridManager.chebyshev(cell, hunter) <= 1:
		score -= 150.0 * (1.0 - urgency)
	if _was_recent(cell):
		score -= 24.0 * (1.0 - urgency)
	return score


func _route_options(grid: GridManager, exit_field: Dictionary, cell: Vector2i, hunter: Vector2i, distance: int) -> int:
	## How many neighbours still make progress towards an exit.
	var routes := 0
	for neighbour in grid.walkable_neighbors(cell):
		if neighbour == hunter:
			continue
		var neighbour_distance: int = exit_field.get(neighbour, UNREACHABLE)
		if neighbour_distance < UNREACHABLE and neighbour_distance <= distance + 1:
			routes += 1
	return routes


func _nearest_exit_path(
	grid: GridManager,
	pathfinder: PathfindingSystem,
	from: Vector2i,
	hunter: Vector2i
) -> Array[Vector2i]:
	## A* route to the closest exit, with the hunter's tile blocked.
	var blocked: Array[Vector2i] = [hunter]
	var best: Array[Vector2i] = []
	for exit_cell in grid.exits:
		var path := pathfinder.find_path(grid, from, exit_cell, blocked)
		if path.is_empty():
			continue
		if best.is_empty() or path.size() < best.size():
			best = path
	return best


func _simulate_pursuit(
	grid: GridManager,
	pathfinder: PathfindingSystem,
	start: Vector2i,
	hunter_start: Vector2i,
	exit_field: Dictionary
) -> int:
	## Plays PREDICTION_TURNS rounds of "hunter chases, fugitive flees".
	## Returns the hunter moves survived; PREDICTION_TURNS + 1 means escaped.
	var fugitive := start
	var hunter := hunter_start
	for turn in PREDICTION_TURNS:
		hunter = _hunter_step(grid, pathfinder, hunter, fugitive)
		if hunter == fugitive:
			return turn
		fugitive = _flee_step(grid, fugitive, hunter, exit_field)
		if grid.is_exit(fugitive):
			return PREDICTION_TURNS + 1
	return PREDICTION_TURNS


func _hunter_step(grid: GridManager, pathfinder: PathfindingSystem, hunter: Vector2i, fugitive: Vector2i) -> Vector2i:
	## The hunter is modelled as a perfect chaser, which is the worst case
	## the fugitive has to plan for.
	var path := pathfinder.find_path(grid, hunter, fugitive)
	if path.is_empty():
		return hunter
	return path[0]


func _flee_step(grid: GridManager, fugitive: Vector2i, hunter: Vector2i, exit_field: Dictionary) -> Vector2i:
	var options := _legal_moves(grid, hunter, fugitive)
	if options.is_empty():
		return fugitive
	var best := fugitive
	var best_score := INF
	for cell in options:
		var distance: int = exit_field.get(cell, UNREACHABLE)
		var score := float(distance) + float(_threat(cell, hunter)) * 2.0
		if score < best_score:
			best_score = score
			best = cell
	return best


func _threat(cell: Vector2i, hunter: Vector2i) -> int:
	match GridManager.chebyshev(cell, hunter):
		0:
			return 24
		1:
			return 12
		2:
			return 4
	return 0
