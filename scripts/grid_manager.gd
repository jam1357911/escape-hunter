class_name GridManager
extends RefCounted
## Static level data: tile types, exits and neighbour queries.
##
## The level is a rectangle of [member size] cells, row 0 being the top row.
## A cell is a [Vector2i] that doubles as its index, so nothing else in the
## game needs to know how the tiles are stored.

enum Tile { WALL, FLOOR, EXIT }

const CARDINAL_DIRECTIONS := [
	Vector2i.UP, Vector2i.RIGHT, Vector2i.DOWN, Vector2i.LEFT,
]

var size := Vector2i(13, 7)
var exits: Array[Vector2i] = []

var _tiles: Array = []


func _init(grid_size := Vector2i(13, 7)) -> void:
	size = grid_size
	reset()


func reset() -> void:
	## Rebuilds an empty room: floor inside, walls around the border.
	_tiles.clear()
	exits.clear()
	for y in size.y:
		var row: Array[int] = []
		row.resize(size.x)
		row.fill(Tile.FLOOR)
		_tiles.append(row)
	for x in size.x:
		_tiles[0][x] = Tile.WALL
		_tiles[size.y - 1][x] = Tile.WALL
	for y in size.y:
		_tiles[y][0] = Tile.WALL
		_tiles[y][size.x - 1] = Tile.WALL


func in_bounds(cell: Vector2i) -> bool:
	return cell.x >= 0 and cell.y >= 0 and cell.x < size.x and cell.y < size.y


func is_interior(cell: Vector2i) -> bool:
	return cell.x > 0 and cell.y > 0 and cell.x < size.x - 1 and cell.y < size.y - 1


func get_tile(cell: Vector2i) -> int:
	if not in_bounds(cell):
		return Tile.WALL
	return _tiles[cell.y][cell.x]


func set_tile(cell: Vector2i, tile: int) -> void:
	if not in_bounds(cell):
		return
	_tiles[cell.y][cell.x] = tile
	if tile == Tile.EXIT:
		if not exits.has(cell):
			exits.append(cell)
	elif exits.has(cell):
		exits.erase(cell)


func is_wall(cell: Vector2i) -> bool:
	return get_tile(cell) == Tile.WALL


func is_walkable(cell: Vector2i) -> bool:
	return in_bounds(cell) and _tiles[cell.y][cell.x] != Tile.WALL


func is_exit(cell: Vector2i) -> bool:
	return get_tile(cell) == Tile.EXIT


func walkable_cells() -> Array[Vector2i]:
	var cells: Array[Vector2i] = []
	for y in size.y:
		for x in size.x:
			if _tiles[y][x] != Tile.WALL:
				cells.append(Vector2i(x, y))
	return cells


func interior_cells() -> Array[Vector2i]:
	var cells: Array[Vector2i] = []
	for y in range(1, size.y - 1):
		for x in range(1, size.x - 1):
			cells.append(Vector2i(x, y))
	return cells


func walkable_neighbors(cell: Vector2i) -> Array[Vector2i]:
	var cells: Array[Vector2i] = []
	for direction in CARDINAL_DIRECTIONS:
		var neighbour: Vector2i = cell + direction
		if is_walkable(neighbour):
			cells.append(neighbour)
	return cells


func load_layout(rows: Array) -> Dictionary:
	## Builds the level from ASCII art and returns the spawn points found in it.
	##
	## Supported glyphs: `#` wall, `.` floor, `E` exit, `H` hunter, `F` fugitive.
	## An empty dictionary means the layout was malformed.
	if rows.is_empty():
		return {}
	var width := String(rows[0]).length()
	if width < 5 or rows.size() < 5:
		return {}
	for row in rows:
		if String(row).length() != width:
			return {}

	size = Vector2i(width, rows.size())
	reset()
	var spawns := {"hunter": Vector2i(-1, -1), "fugitive": Vector2i(-1, -1)}
	for y in size.y:
		var line := String(rows[y])
		for x in size.x:
			var cell := Vector2i(x, y)
			match line[x]:
				"#":
					_tiles[y][x] = Tile.WALL
				"E":
					set_tile(cell, Tile.EXIT)
				"H":
					spawns["hunter"] = cell
				"F":
					spawns["fugitive"] = cell
				_:
					pass
	return spawns


static func manhattan(a: Vector2i, b: Vector2i) -> int:
	return absi(a.x - b.x) + absi(a.y - b.y)


static func chebyshev(a: Vector2i, b: Vector2i) -> int:
	return maxi(absi(a.x - b.x), absi(a.y - b.y))
