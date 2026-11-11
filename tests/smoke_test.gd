extends SceneTree
## Headless logic checks for Escape Hunter.
##
## Run from the project folder:
##     godot --headless --path . --script res://tests/smoke_test.gd
##
## The tests exercise the pure logic layer (grid, generation, pathfinding, AI)
## and do not need the scene or a rendering device.

var _checks := 0
var _failures := 0


func _initialize() -> void:
	print("Escape Hunter - logic smoke tests")
	_test_layout()
	_test_pathfinding()
	_test_generation()
	_test_ai()
	_test_player_controller()
	print("")
	if _failures == 0:
		print("ALL %d CHECKS PASSED" % _checks)
	else:
		printerr("%d of %d CHECKS FAILED" % [_failures, _checks])
	quit(0 if _failures == 0 else 1)


func _check(condition: bool, label: String) -> void:
	_checks += 1
	if condition:
		print("  ok    %s" % label)
	else:
		_failures += 1
		printerr("  FAIL  %s" % label)


func _test_layout() -> void:
	print("Layout parsing")
	var grid := GridManager.new()
	var spawns := grid.load_layout(MapGenerator.FALLBACK_LAYOUT)
	_check(grid.size == Vector2i(15, 15), "layout sets the grid size")
	_check(spawns["hunter"] == Vector2i(1, 1), "hunter spawn is parsed")
	_check(spawns["fugitive"] == Vector2i(8, 11), "fugitive spawn is parsed")
	_check(grid.exits.size() == 1 and grid.exits[0] == Vector2i(13, 1), "exit is parsed")
	_check(not grid.is_walkable(Vector2i(0, 0)), "the border is solid")
	_check(grid.is_walkable(Vector2i(8, 11)), "floor is walkable")


func _test_pathfinding() -> void:
	print("Pathfinding")
	var grid := GridManager.new(Vector2i(7, 5))
	var pathfinder := PathfindingSystem.new()
	var origin: Array[Vector2i] = [Vector2i(1, 1)]

	var path := pathfinder.find_path(grid, Vector2i(1, 1), Vector2i(5, 3))
	_check(path.size() == 6, "A* path length matches Manhattan distance")
	_check(path[path.size() - 1] == Vector2i(5, 3), "the path ends on the goal")
	_check(not path.has(Vector2i(1, 1)), "the path excludes the start cell")

	var distances := pathfinder.distances_from(grid, origin)
	_check(int(distances.get(Vector2i(5, 1), -1)) == 4, "BFS distance field is correct")

	grid.set_tile(Vector2i(2, 1), GridManager.Tile.WALL)
	var detour := pathfinder.find_path(grid, Vector2i(1, 1), Vector2i(5, 3))
	_check(not detour.has(Vector2i(2, 1)), "A* routes around walls")
	_check(pathfinder.next_step(grid, Vector2i(1, 1), Vector2i(5, 3)) == Vector2i(1, 2), "next_step returns one tile")

	# Seal the goal in a corner: no neighbour is walkable any more.
	grid.set_tile(Vector2i(4, 3), GridManager.Tile.WALL)
	grid.set_tile(Vector2i(5, 2), GridManager.Tile.WALL)
	_check(pathfinder.find_path(grid, Vector2i(1, 1), Vector2i(5, 3)).is_empty(), "an unreachable goal returns no path")
	_check(not pathfinder.is_reachable(grid, Vector2i(1, 1), Vector2i(5, 3)), "is_reachable agrees with find_path")


func _test_generation() -> void:
	print("Map generation")
	var pathfinder := PathfindingSystem.new()
	var rng := RandomNumberGenerator.new()
	var broken := 0
	for index in 150:
		rng.seed = index * 7919 + 13
		var grid := GridManager.new(Vector2i(15, 15))
		var spawns := MapGenerator.generate(grid, rng)
		var hunter: Vector2i = spawns.get("hunter", Vector2i(-1, -1))
		var fugitive: Vector2i = spawns.get("fugitive", Vector2i(-1, -1))
		var ok := grid.is_walkable(hunter) and grid.is_walkable(fugitive)
		ok = ok and hunter != fugitive
		ok = ok and grid.exits.size() >= 1
		if grid.exits.size() >= 1:
			var exit_cell: Vector2i = grid.exits[0]
			ok = ok and hunter != exit_cell and fugitive != exit_cell
			ok = ok and pathfinder.is_reachable(grid, hunter, fugitive)
			ok = ok and pathfinder.is_reachable(grid, fugitive, exit_cell)
		if not ok:
			broken += 1
	_check(broken == 0, "150 random maps spawn both actors and a reachable exit")


func _test_ai() -> void:
	print("Fugitive AI")
	var grid := GridManager.new()
	grid.load_layout([
		"#########",
		"#.......#",
		"#..H....#",
		"#.F....E#",
		"#.......#",
		"#########",
	])
	var pathfinder := PathfindingSystem.new()
	var hunter := Vector2i(3, 2)
	var fugitive := Vector2i(2, 3)

	for difficulty in FugitiveAI.Difficulty.values():
		var ai := FugitiveAI.new()
		ai.difficulty = difficulty
		var move := ai.choose_move(grid, pathfinder, hunter, fugitive)
		_check(grid.is_walkable(move), "difficulty %d returns a walkable tile" % difficulty)
		_check(GridManager.manhattan(move, fugitive) == 1, "difficulty %d moves exactly one tile" % difficulty)
		_check(move != hunter, "difficulty %d never steps onto the hunter" % difficulty)

	var expert := FugitiveAI.new()
	expert.difficulty = FugitiveAI.Difficulty.EXPERT
	var expert_move := expert.choose_move(grid, pathfinder, hunter, fugitive)
	_check(GridManager.chebyshev(expert_move, hunter) > 1, "Expert keeps out of the hunter's reach")

	var trapped := GridManager.new(Vector2i(5, 5))
	var ai := FugitiveAI.new()
	# The hunter occupies the only other tile next to the fugitive's corner.
	var trapped_move := ai.choose_move(trapped, pathfinder, Vector2i(1, 2), Vector2i(1, 1))
	_check(trapped_move == Vector2i(1, 1) or trapped.is_walkable(trapped_move), "AI always returns a usable tile")


func _test_player_controller() -> void:
	print("Player controller")
	var grid := GridManager.new(Vector2i(7, 5))
	var controller := PlayerController.new()
	controller.cell = Vector2i(1, 1)
	_check(PlayerController.direction_for_key(KEY_W) == Vector2i.UP, "W maps to up")
	_check(PlayerController.direction_for_key(KEY_A) == Vector2i.LEFT, "A maps to left")
	_check(PlayerController.direction_for_key(KEY_DOWN) == Vector2i.DOWN, "Down maps to down")
	_check(PlayerController.direction_for_key(KEY_RIGHT) == Vector2i.RIGHT, "Right maps to right")
	_check(controller.try_move(grid, Vector2i.RIGHT), "a legal move is accepted")
	_check(controller.cell == Vector2i(2, 1), "the hunter cell is updated")
	_check(not controller.try_move(grid, Vector2i.UP), "a move into a border wall is refused")
	_check(controller.cell == Vector2i(2, 1), "a refused move leaves the hunter where it was")
	_check(controller.try_move(grid, Vector2i.LEFT), "the hunter can step back")
	_check(controller.cell == Vector2i(1, 1), "the hunter cell tracks the second move")
	controller.free()
