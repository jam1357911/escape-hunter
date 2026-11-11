class_name PathfindingSystem
extends RefCounted
## Grid search helpers shared by the fugitive AI and the game rules.
##
## The search graph is the 4-neighbourhood of walkable cells and every step
## costs 1, so Manhattan distance is an admissible A* heuristic.
## [method find_path] returns the route without its starting cell, which makes
## `path[0]` the next tile to step on.

const IMPASSABLE := 1 << 30


func find_path(grid: GridManager, start: Vector2i, goal: Vector2i, blocked: Array[Vector2i] = []) -> Array[Vector2i]:
	## A* from [param start] to [param goal]. Returns an empty array when the
	## goal is unreachable or blocked.
	if start == goal:
		return []
	var blocked_set := {}
	for cell in blocked:
		blocked_set[cell] = true
	if not grid.is_walkable(goal) or blocked_set.has(goal):
		return []

	var open: Array[Vector2i] = [start]
	var closed := {}
	var came_from := {}
	var cost_so_far := {start: 0}
	var estimate := {start: _heuristic(start, goal)}

	while not open.is_empty():
		var current := _take_best(open, estimate)
		if closed.has(current):
			continue
		closed[current] = true
		if current == goal:
			return _reconstruct(came_from, current)

		for neighbour in grid.walkable_neighbors(current):
			if blocked_set.has(neighbour) or closed.has(neighbour):
				continue
			var new_cost: int = cost_so_far[current] + 1
			if new_cost < int(cost_so_far.get(neighbour, IMPASSABLE)):
				cost_so_far[neighbour] = new_cost
				estimate[neighbour] = new_cost + _heuristic(neighbour, goal)
				came_from[neighbour] = current
				if not open.has(neighbour):
					open.append(neighbour)
	return []


func distances_from(grid: GridManager, origins: Array[Vector2i], blocked: Array[Vector2i] = []) -> Dictionary:
	## Breadth-first flood fill. Returns a `Vector2i -> step count` dictionary
	## mapping every reachable cell to its distance from the closest origin.
	var blocked_set := {}
	for cell in blocked:
		blocked_set[cell] = true

	var distances := {}
	var frontier: Array[Vector2i] = []
	for origin in origins:
		if grid.is_walkable(origin) and not blocked_set.has(origin):
			distances[origin] = 0
			frontier.append(origin)

	var head := 0
	while head < frontier.size():
		var cell: Vector2i = frontier[head]
		head += 1
		var distance: int = distances[cell]
		for neighbour in grid.walkable_neighbors(cell):
			if blocked_set.has(neighbour) or distances.has(neighbour):
				continue
			distances[neighbour] = distance + 1
			frontier.append(neighbour)
	return distances


func next_step(grid: GridManager, from: Vector2i, goal: Vector2i, blocked: Array[Vector2i] = []) -> Vector2i:
	var path := find_path(grid, from, goal, blocked)
	if path.is_empty():
		return from
	return path[0]


func is_reachable(grid: GridManager, from: Vector2i, goal: Vector2i, blocked: Array[Vector2i] = []) -> bool:
	return from == goal or not find_path(grid, from, goal, blocked).is_empty()


func _take_best(open: Array[Vector2i], estimate: Dictionary) -> Vector2i:
	var best_index := 0
	var best_score := float(estimate.get(open[0], INF))
	for index in range(1, open.size()):
		var score := float(estimate.get(open[index], INF))
		if score < best_score:
			best_score = score
			best_index = index
	return open.pop_at(best_index)


func _reconstruct(came_from: Dictionary, current: Vector2i) -> Array[Vector2i]:
	var path: Array[Vector2i] = []
	while came_from.has(current):
		path.append(current)
		current = came_from[current]
	path.reverse()
	return path


func _heuristic(a: Vector2i, b: Vector2i) -> int:
	return absi(a.x - b.x) + absi(a.y - b.y)
