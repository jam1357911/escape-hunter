class_name MapGenerator
extends RefCounted
## Builds random, always-solvable levels.
##
## The board is filled with roughly 40% walls, then every disconnected pocket
## is joined to the main region by carving a 4-neighbour tunnel. That keeps the
## maze dense while guaranteeing the hunter, the fugitive and the exit can
## always reach each other.
##
## Spawns are placed so the hunter starts on the exit side of the fugitive:
## cutting the fugitive off is a real plan instead of a hopeless race.

const MAX_ATTEMPTS := 60
const WALL_DENSITY := 0.4
const MIN_OPEN_CELLS := 85
const MIN_HUNTER_EXIT_DISTANCE := 6
const MIN_HUNTER_FUGITIVE_DISTANCE := 8
const MIN_FUGITIVE_EXIT_DISTANCE := 8

const FALLBACK_LAYOUT := [
	"###############",
	"#H...........E#",
	"#.............#",
	"#....##.......#",
	"#.............#",
	"#.......##....#",
	"#.............#",
	"#.....#.......#",
	"#.............#",
	"#..##.........#",
	"#.............#",
	"#.......F.....#",
	"#.............#",
	"#.............#",
	"###############",
]


static func generate(grid: GridManager, rng: RandomNumberGenerator) -> Dictionary:
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
	for cell in grid.interior_cells():
		if rng.randf() < WALL_DENSITY:
			grid.set_tile(cell, GridManager.Tile.WALL)
	_connect(grid)


static func _connect(grid: GridManager) -> void:
	## Tunnels 4-connected paths from the main region to the next orphaned tile.
	for _pass in 400:
		var open_cells := grid.walkable_cells()
		if open_cells.is_empty():
			return

		var main := {}
		main[open_cells[0]] = true
		var flood: Array[Vector2i] = [open_cells[0]]
		while not flood.is_empty():
			var cell: Vector2i = flood.pop_back()
			for neighbour in grid.walkable_neighbors(cell):
				if main.has(neighbour):
					continue
				main[neighbour] = true
				flood.append(neighbour)

		var orphan := Vector2i(-1, -1)
		for cell in open_cells:
			if not main.has(cell):
				orphan = cell
				break
		if orphan == Vector2i(-1, -1):
			return

		var previous := {}
		var queue: Array[Vector2i] = []
		for cell in main:
			var start: Vector2i = cell
			previous[start] = Vector2i(-1, -1)
			queue.append(start)

		var target := Vector2i(-1, -1)
		var head := 0
		while head < queue.size() and target == Vector2i(-1, -1):
			var current: Vector2i = queue[head]
			head += 1
			for direction in GridManager.CARDINAL_DIRECTIONS:
				var next: Vector2i = current + direction
				if not grid.is_interior(next) or previous.has(next):
					continue
				previous[next] = current
				queue.append(next)
				if next == orphan:
					target = next
					break

		if target == Vector2i(-1, -1):
			return

		var cursor := target
		while cursor != Vector2i(-1, -1):
			if grid.is_wall(cursor):
				grid.set_tile(cursor, GridManager.Tile.FLOOR)
			cursor = previous[cursor]


static func _is_playable(grid: GridManager) -> bool:
	var open_cells := grid.walkable_cells()
	if open_cells.size() < MIN_OPEN_CELLS:
		return false

	var seen := {}
	seen[open_cells[0]] = true
	var frontier: Array[Vector2i] = [open_cells[0]]
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

	var exit_options: Array[Vector2i] = []
	for cell in open_cells:
		if cell != hunter and GridManager.manhattan(cell, hunter) >= MIN_HUNTER_EXIT_DISTANCE:
			exit_options.append(cell)
	if exit_options.is_empty():
		return {}
	var exit_cell: Vector2i = _pick(exit_options, rng)
	grid.set_tile(exit_cell, GridManager.Tile.EXIT)

	# Relax the spacing so a cramped map still gets a spawn. The strict pass
	# also requires the hunter to be nearer the exit than the fugitive.
	for attempt in 3:
		var hunter_gap := maxi(4, MIN_HUNTER_FUGITIVE_DISTANCE - attempt * 2)
		var exit_gap := maxi(3, MIN_FUGITIVE_EXIT_DISTANCE - attempt * 2)
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
		return {"hunter": Vector2i(1, 1), "fugitive": Vector2i(8, 11)}
	return spawns


static func _pick(cells: Array[Vector2i], rng: RandomNumberGenerator) -> Vector2i:
	return cells[rng.randi_range(0, cells.size() - 1)]
