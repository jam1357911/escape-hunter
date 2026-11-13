extends Control
## Escape Hunter - game coordinator.
##
## Owns the turn state machine and connects the pure logic classes
## (GridManager, PathfindingSystem, FugitiveAI) to the passive views
## (BoardView, GameHUD). Turn order:
##
##   1. hunter moves        -> capture check
##   2. fugitive moves      -> exit check
##   3. repeat
##
## The scene root uses this script, so it also handles the global restart key.

enum State { IDLE, PLAYER_TURN, FUGITIVE_TURN, GAME_OVER }
enum Outcome { NONE, HUNTER_WINS, FUGITIVE_WINS }

const GRID_SIZE := Vector2i(15, 15)
const TURN_DELAY := 0.18 ## Seconds the fugitive "thinks" before it moves.

@onready var board: BoardView = %Board
@onready var hud: GameHUD = %HUD

var grid: GridManager
var pathfinder := PathfindingSystem.new()
var player := PlayerController.new()
var fugitive_ai := FugitiveAI.new()
var rng := RandomNumberGenerator.new()

var state: int = State.IDLE
var turn_count := 0
var hunter_cell := Vector2i.ZERO
var fugitive_cell := Vector2i.ZERO

## Bumped whenever a game starts or ends so pending timers can bail out.
var _run_token := 0


func _ready() -> void:
	rng.randomize()
	add_child(player)
	player.move_requested.connect(_on_move_requested)
	hud.restart_requested.connect(start_new_game)
	hud.play_again_requested.connect(start_new_game)
	hud.difficulty_changed.connect(_on_difficulty_changed)
	start_new_game()


func start_new_game() -> void:
	_run_token += 1
	grid = GridManager.new(GRID_SIZE)
	var spawns := MapGenerator.generate(grid, rng)
	hunter_cell = spawns.get("hunter", Vector2i(1, 1))
	fugitive_cell = spawns.get("fugitive", Vector2i(8, 11))
	player.cell = hunter_cell
	fugitive_ai.reset()
	turn_count = 0
	state = State.PLAYER_TURN

	board.set_grid(grid)
	board.set_actors(hunter_cell, fugitive_cell, true)
	hud.reset_board_state(turn_count, fugitive_ai.difficulty)
	hud.hide_result()
	hud.set_status("Hunt the fugitive before it slips through the exit.")


func _on_move_requested(direction: Vector2i) -> void:
	if state != State.PLAYER_TURN:
		return
	if not player.try_move(grid, direction):
		board.nudge(direction)
		return

	hunter_cell = player.cell
	turn_count += 1
	board.set_actors(hunter_cell, fugitive_cell)
	hud.set_turn(turn_count)

	if hunter_cell == fugitive_cell:
		_finish(Outcome.HUNTER_WINS)
		return

	state = State.FUGITIVE_TURN
	hud.set_status("The fugitive is on the move...")
	_run_fugitive_turn()


func _run_fugitive_turn() -> void:
	var token := _run_token
	await get_tree().create_timer(TURN_DELAY).timeout
	if token != _run_token or state != State.FUGITIVE_TURN:
		return

	fugitive_cell = fugitive_ai.choose_move(grid, pathfinder, hunter_cell, fugitive_cell, turn_count)
	board.set_actors(hunter_cell, fugitive_cell)

	if fugitive_cell == hunter_cell:
		_finish(Outcome.HUNTER_WINS)
		return
	if grid.is_exit(fugitive_cell):
		_finish(Outcome.FUGITIVE_WINS)
		return

	state = State.PLAYER_TURN
	hud.set_status(_player_hint())


func _on_difficulty_changed(index: int) -> void:
	fugitive_ai.difficulty = index
	hud.set_status("Difficulty %s - %s" % [FugitiveAI.DIFFICULTY_NAMES[index], FugitiveAI.DIFFICULTY_HINTS[index]])


func _finish(outcome: int) -> void:
	state = State.GAME_OVER
	_run_token += 1
	if outcome == Outcome.HUNTER_WINS:
		hud.set_status("Case closed.")
		hud.show_result("CAUGHT", "You pinned the fugitive after %d turns. Press R to hunt again." % turn_count, true)
	else:
		hud.set_status("The exit swallowed your target.")
		hud.show_result("ESCAPED", "The fugitive reached the exit on turn %d. Press R for a new map." % turn_count, false)


func _player_hint() -> String:
	var distance := GridManager.manhattan(hunter_cell, fugitive_cell)
	if distance <= 1:
		return "It is right beside you - one clean step closes the hunt."
	if distance <= 3:
		return "Close in. The fugitive is %d tiles away." % distance
	return "Your move. The fugitive is %d tiles away." % distance


func _unhandled_input(event: InputEvent) -> void:
	var key := event as InputEventKey
	if key == null or not key.pressed or key.echo:
		return
	if key.keycode != KEY_R:
		return
	get_viewport().set_input_as_handled()
	start_new_game()
