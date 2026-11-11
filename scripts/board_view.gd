class_name BoardView
extends Control
## Draws the grid, the exit and both actors. Purely a view: it never changes
## game state. Positions are interpolated towards their target cell so turns
## read as movement instead of teleporting.

const PADDING := 4.0
const MOVE_SMOOTHING := 18.0

const SEAM := Color(0.055, 0.082, 0.125)
const FLOOR_A := Color(0.145, 0.204, 0.286)
const FLOOR_B := Color(0.161, 0.227, 0.314)
const WALL := Color(0.043, 0.070, 0.114)
const WALL_EDGE := Color(0.176, 0.247, 0.341)
const EXIT_FILL := Color(0.100, 0.360, 0.247)
const EXIT_GLOW := Color(0.400, 0.980, 0.659)
const HUNTER := Color(1.000, 0.694, 0.235)
const FUGITIVE := Color(0.655, 0.443, 1.000)
const INK := Color(0.043, 0.063, 0.094)

var grid: GridManager
var hunter_cell := Vector2i.ZERO
var fugitive_cell := Vector2i.ZERO

var _hunter_visual := Vector2.ZERO
var _fugitive_visual := Vector2.ZERO
var _origin := Vector2.ZERO
var _cell_px := 48.0
var _time := 0.0
var _nudge := Vector2.ZERO

var _floor_a_style: StyleBoxFlat
var _floor_b_style: StyleBoxFlat
var _wall_style: StyleBoxFlat


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_floor_a_style = _rounded(FLOOR_A, 4)
	_floor_b_style = _rounded(FLOOR_B, 4)
	_wall_style = _rounded(WALL, 7, WALL_EDGE)


func _process(delta: float) -> void:
	if grid == null:
		return
	_time += delta

	var hunter_target := Vector2(hunter_cell)
	var fugitive_target := Vector2(fugitive_cell)
	var weight := 1.0 - exp(-MOVE_SMOOTHING * delta)
	_hunter_visual = _hunter_visual.lerp(hunter_target, weight)
	_fugitive_visual = _fugitive_visual.lerp(fugitive_target, weight)
	if _hunter_visual.distance_to(hunter_target) < 0.004:
		_hunter_visual = hunter_target
	if _fugitive_visual.distance_to(fugitive_target) < 0.004:
		_fugitive_visual = fugitive_target

	_nudge = _nudge.lerp(Vector2.ZERO, 1.0 - exp(-10.0 * delta))
	if _nudge.length() < 0.5:
		_nudge = Vector2.ZERO

	queue_redraw()


func set_grid(new_grid: GridManager) -> void:
	grid = new_grid
	queue_redraw()


func set_actors(hunter: Vector2i, fugitive: Vector2i, instant := false) -> void:
	hunter_cell = hunter
	fugitive_cell = fugitive
	if instant:
		_hunter_visual = Vector2(hunter)
		_fugitive_visual = Vector2(fugitive)
	queue_redraw()


func nudge(direction: Vector2i) -> void:
	## Small shake when the hunter walks into a wall.
	_nudge = Vector2(direction) * minf(9.0, _cell_px * 0.18)


func _draw() -> void:
	if grid == null:
		return

	var board_cells := Vector2(grid.size)
	var available := size - Vector2(PADDING, PADDING) * 2.0
	if available.x <= 0.0 or available.y <= 0.0:
		return
	_cell_px = minf(available.x / board_cells.x, available.y / board_cells.y)
	if _cell_px < 4.0:
		return
	_origin = (size - board_cells * _cell_px) * 0.5
	draw_rect(Rect2(_origin, board_cells * _cell_px), SEAM)

	for y in grid.size.y:
		for x in grid.size.x:
			_draw_tile(Vector2i(x, y))

	_draw_actor(_fugitive_visual, FUGITIVE, "F", Vector2.ZERO)
	_draw_actor(_hunter_visual, HUNTER, "H", _nudge)


func _draw_tile(cell: Vector2i) -> void:
	var cell_rect := _cell_rect(cell)
	var tile := grid.get_tile(cell)

	if tile == GridManager.Tile.WALL:
		var block := cell_rect.grow(-maxf(2.0, _cell_px * 0.045))
		draw_style_box(_wall_style, block)
		return

	var checker := (cell.x + cell.y) % 2 == 0
	var floor_rect := cell_rect.grow(-maxf(1.0, _cell_px * 0.018))
	draw_style_box(_floor_a_style if checker else _floor_b_style, floor_rect)

	if tile == GridManager.Tile.EXIT:
		var center := floor_rect.get_center()
		var pulse := 0.5 + 0.5 * sin(_time * 2.4)
		var radius := _cell_px * (0.29 + 0.02 * pulse)
		draw_circle(center, radius * 1.6, Color(EXIT_GLOW.r, EXIT_GLOW.g, EXIT_GLOW.b, 0.05 + 0.04 * pulse))
		draw_circle(center, radius, EXIT_FILL)
		draw_arc(center, radius, 0.0, TAU, 40, Color(EXIT_GLOW.r, EXIT_GLOW.g, EXIT_GLOW.b, 0.55 + 0.25 * pulse), 2.0)
		_draw_glyph(center, "E", radius * 2.0, EXIT_GLOW)


func _draw_actor(visual_position: Vector2, color: Color, glyph: String, offset: Vector2) -> void:
	var center := _origin + (visual_position + Vector2(0.5, 0.5)) * _cell_px + offset
	var radius := _cell_px * 0.32
	draw_circle(center + Vector2(0.0, radius * 0.14), radius * 1.02, Color(0.0, 0.0, 0.0, 0.28))
	draw_circle(center, radius, color)
	draw_circle(center, radius * 0.82, color.lightened(0.16))
	draw_arc(center, radius, 0.0, TAU, 40, color.darkened(0.30), maxf(1.5, _cell_px * 0.028))
	_draw_glyph(center, glyph, radius * 2.0, INK)


func _draw_glyph(center: Vector2, text: String, glyph_box: float, color: Color) -> void:
	var font := ThemeDB.fallback_font
	var font_size := int(glyph_box * 0.52)
	var baseline := center.y + font_size * 0.36
	draw_string(
		font,
		Vector2(center.x - glyph_box * 0.5, baseline),
		text,
		HORIZONTAL_ALIGNMENT_CENTER,
		glyph_box,
		font_size,
		color
	)


func _cell_rect(cell: Vector2i) -> Rect2:
	var rect := Rect2(_origin + Vector2(cell) * _cell_px, Vector2(_cell_px, _cell_px))
	return rect.grow(-maxf(2.0, _cell_px * 0.045))


static func _rounded(color: Color, radius: int, border: Color = Color(0, 0, 0, 0)) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = color
	style.set_corner_radius_all(radius)
	style.anti_aliasing = true
	if border.a > 0.0:
		style.border_color = border
		style.set_border_width_all(1)
	return style
