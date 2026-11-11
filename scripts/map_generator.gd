class_name MapGenerator
extends RefCounted
## Builds random, always-solvable levels.
##
## Walls are carved with a few short random walks, then the layout is
## validated (connected and open enough) before the hunter, the fugitive and
## the exit are placed far enough apart to make the chase interesting.

const MAX_ATTEMPTS := 60
const MIN_OPEN_CELLS := 26
const MIN_HUNTER_EXIT_DISTANCE := 4
const MIN_HUNTER_FUGITIVE_DISTANCE := 5
const MIN_FUGITIVE_EXIT_DISTANCE := 5

## Deterministic map used if random generation somehow fails every attempt.
const FALLBACK_LAYOUT := [
	"#############",
	"#H.........E#",
	"#...........#",
	"#....##.....#",
	"#...........#",
	"#.....F.....#",
	"#############",
]


static func generate(grid: GridManager, rng: RandomNumberGenerator) -> Dictionary:
	## Fills [param grid] and returns `{"hunter": Vector2i, "fugitive": Vector2i}`.
	for _attempt in MAX_ATTEMPTS:
		_carve(grid, rng)
		if not _is_playable(grid):
			continue
		var spawns := _place_actors(grid, rng)
		if not spawns.is_empty():
			return spawns
	return _fallback(grid)


static func _carve(grid: GridManager, rng: RandomNumberGenerator) -> void:
	grid.reset()
	var interior := grid.interior_cells()

	# Short random walks read as natural wall clusters instead of noise.
	for _walker in rng.randi_range(3, 4):
		var cell: Vector2i = interior[rng.randi_range(0, interior.size() - 1)]
		for _step in rng.randi_range(4, 7):
			if grid.is_interior(cell):
				grid.set_tile(cell, GridManager.Tile.WALL)
			var direction: Vector2i = GridManager.CARDINAL_DIRECTIONS[rng.randi_range(0, 3)]
			cell += direction

	# A few loose pillars break up the long open corridors.
	for _pillar in 6:
		if rng.randf() >= 0.07:
			continue
		var pillar: Vector2i = interior[rng.randi_range(0, interior.size() - 1)]
		if grid.is_interior(pillar):
			grid.set_tile(pillar, GridManager.Tile.WALL)


static func _is_playable(grid: GridManager) -> bool:
	var open_cells := grid.walkable_cells()
	if open_cells.size() < MIN_OPEN_CELLS:
		return false

	# Every floor tile must belong to the same region, otherwise a spawn or the
	# exit could end up sealed inside a pocket.
	var seen := {}
	var frontier: Array[Vector2i] = [open_cells[0]]
	seen[open_cells[0]] = true
	while not frontier.is_empty():
		var cell: Vector2i = frontier.pop_back()
		for neighbour in grid.walkable_neighbors(cell):
			if seen.has(neighbour):
				continue
			seen[neighbour] = true
			frontier.append(neighbour)
	return seen.size() == open_cells.size()


static func _place_actors(grid: GridManager, rng: RandomNumberGenerator) -> Dictionary:
	var open_cells := grid.walkable_cells()
	if open_cells.size() < MIN_OPEN_CELLS:
		return {}

	var hunter: Vector2i = _pick(open_cells, rng)

	# The exit must be a real trek away from the hunter's starting tile.
	var exit_options: Array[Vector2i] = []
	for cell in open_cells:
		if cell != hunter and GridManager.manhattan(cell, hunter) >= MIN_HUNTER_EXIT_DISTANCE:
			exit_options.append(cell)
	if exit_options.is_empty():
		return {}
	var exit_cell: Vector2i = _pick(exit_options, rng)
	grid.set_tile(exit_cell, GridManager.Tile.EXIT)

	# Progressively relax the spawn spacing so generation never gives up on a
	# cramped but otherwise valid map. The strict pass also requires the hunter
	# to start closer to the exit than the fugitive, which makes cutting the
	# fugitive off a real plan instead of a hopeless race.
	for attempt in 3:
		var hunter_gap := maxi(3, MIN_HUNTER_FUGITIVE_DISTANCE - attempt * 2)
		var exit_gap := maxi(2, MIN_FUGITIVE_EXIT_DISTANCE - attempt * 2)
		var candidates: Array[Vector2i] = []
		for cell in open_cells:
			if cell == hunter or cell == exit_cell:
				continue
			if GridManager.manhattan(cell, hunter) < hunter_gap:
				continue
			if GridManager.manhattan(cell, exit_cell) < exit_gap:
				continue
			if attempt == 0 and GridManager.manhattan(hunter, exit_cell) >= GridManager.manhattan(cell, exit_cell):
				continue
			if grid.walkable_neighbors(cell).size() < 2:
				continue
			candidates.append(cell)
		if not candidates.is_empty():
			return {"hunter": hunter, "fugitive": _pick(candidates, rng)}

	for cell in open_cells:
		if cell != hunter and cell != exit_cell:
			return {"hunter": hunter, "fugitive": cell}
	return {}


static func _fallback(grid: GridManager) -> Dictionary:
	var spawns := grid.load_layout(FALLBACK_LAYOUT)
	if spawns.is_empty() or spawns["hunter"] == Vector2i(-1, -1) or spawns["fugitive"] == Vector2i(-1, -1):
		return {"hunter": Vector2i(1, 1), "fugitive": Vector2i(6, 5)}
	return spawns


static func _pick(cells: Array[Vector2i], rng: RandomNumberGenerator) -> Vector2i:
	return cells[rng.randi_range(0, cells.size() - 1)]
