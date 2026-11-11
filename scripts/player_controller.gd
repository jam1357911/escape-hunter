class_name PlayerController
extends Node
## Turns keyboard input into hunter moves.
##
## The controller only decides *whether* a move is legal; the turn order and
## win checks stay in GameManager so this class remains testable and reusable.

signal move_requested(direction: Vector2i)

## Current hunter tile. GameManager keeps it in sync after every move.
var cell := Vector2i.ZERO


func _unhandled_input(event: InputEvent) -> void:
	var key := event as InputEventKey
	if key == null or not key.pressed or key.echo:
		return
	var direction := direction_for_key(key.keycode)
	if direction == Vector2i.ZERO:
		# physical_keycode keeps WASD working on non-QWERTY layouts.
		direction = direction_for_key(key.physical_keycode)
	if direction == Vector2i.ZERO:
		return
	get_viewport().set_input_as_handled()
	move_requested.emit(direction)


func try_move(grid: GridManager, direction: Vector2i) -> bool:
	## Steps the hunter if the destination is walkable. Returns whether it moved.
	if direction == Vector2i.ZERO:
		return false
	var target := cell + direction
	if not grid.is_walkable(target):
		return false
	cell = target
	return true


static func direction_for_key(keycode: int) -> Vector2i:
	match keycode:
		KEY_UP, KEY_W:
			return Vector2i.UP
		KEY_RIGHT, KEY_D:
			return Vector2i.RIGHT
		KEY_DOWN, KEY_S:
			return Vector2i.DOWN
		KEY_LEFT, KEY_A:
			return Vector2i.LEFT
	return Vector2i.ZERO
