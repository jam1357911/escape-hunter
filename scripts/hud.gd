class_name GameHUD
extends Control
## Text, buttons and the win/lose overlay.
##
## The HUD is passive: GameManager calls the setters below and reacts to the
## signals this class emits. All theming lives here so the scene file stays a
## plain layout.

signal restart_requested
signal play_again_requested
signal difficulty_changed(index: int)

const C_TEXT := Color(0.918, 0.941, 0.988)
const C_MUTED := Color(0.545, 0.627, 0.741)
const C_ACCENT := Color(0.353, 0.820, 1.000)
const C_WIN := Color(0.341, 0.890, 0.608)
const C_LOSE := Color(1.000, 0.482, 0.541)
const C_PANEL_SOFT := Color(0.086, 0.118, 0.173)
const C_EDGE := Color(0.149, 0.208, 0.298)

@onready var title_label: Label = %Title
@onready var subtitle_label: Label = %Subtitle
@onready var turn_panel: PanelContainer = %TurnPanel
@onready var turn_caption: Label = %TurnCaption
@onready var turn_value: Label = %TurnValue
@onready var difficulty_picker: OptionButton = %DifficultyPicker
@onready var restart_button: Button = %RestartButton
@onready var status_label: Label = %StatusLabel
@onready var legend_label: Label = %Legend
@onready var board_frame: PanelContainer = %BoardFrame
@onready var overlay: Control = %Overlay
@onready var result_card: PanelContainer = %ResultCard
@onready var result_title: Label = %ResultTitle
@onready var result_message: Label = %ResultMessage
@onready var play_again_button: Button = %PlayAgainButton

var _overlay_tween: Tween


func _ready() -> void:
	_style_static_text()
	_style_containers()
	_style_controls()
	_populate_difficulties()
	difficulty_picker.item_selected.connect(_on_difficulty_selected)
	restart_button.pressed.connect(_on_restart_pressed)
	play_again_button.pressed.connect(_on_play_again_pressed)
	overlay.visible = false


# --- API used by GameManager ------------------------------------------------


func set_turn(value: int) -> void:
	turn_value.text = str(value)
	turn_value.pivot_offset = turn_value.size * 0.5
	var tween := create_tween()
	tween.tween_property(turn_value, "scale", Vector2(1.14, 1.14), 0.06)
	tween.tween_property(turn_value, "scale", Vector2.ONE, 0.14)


func reset_board_state(turn: int, difficulty: int) -> void:
	turn_value.text = str(turn)
	turn_value.scale = Vector2.ONE
	difficulty_picker.select(difficulty)


func set_difficulty(difficulty: int) -> void:
	difficulty_picker.select(difficulty)


func set_status(text: String) -> void:
	status_label.text = text


func show_result(title: String, message: String, victory: bool) -> void:
	result_title.text = title
	result_title.add_theme_color_override("font_color", C_WIN if victory else C_LOSE)
	result_message.text = message
	overlay.visible = true
	overlay.modulate = Color(1.0, 1.0, 1.0, 0.0)
	_kill_overlay_tween()
	_overlay_tween = create_tween()
	_overlay_tween.tween_property(overlay, "modulate:a", 1.0, 0.22)


func hide_result() -> void:
	_kill_overlay_tween()
	overlay.visible = false
	overlay.modulate = Color(1.0, 1.0, 1.0, 1.0)


# --- Signals ----------------------------------------------------------------


func _on_restart_pressed() -> void:
	restart_requested.emit()


func _on_play_again_pressed() -> void:
	play_again_requested.emit()


func _on_difficulty_selected(index: int) -> void:
	difficulty_changed.emit(index)


# --- Theming ----------------------------------------------------------------


func _style_static_text() -> void:
	title_label.add_theme_font_size_override("font_size", 32)
	title_label.add_theme_color_override("font_color", C_TEXT)
	subtitle_label.add_theme_font_size_override("font_size", 13)
	subtitle_label.add_theme_color_override("font_color", C_MUTED)
	turn_caption.add_theme_font_size_override("font_size", 10)
	turn_caption.add_theme_color_override("font_color", C_MUTED)
	turn_value.add_theme_font_size_override("font_size", 30)
	turn_value.add_theme_color_override("font_color", C_ACCENT)
	status_label.add_theme_font_size_override("font_size", 15)
	status_label.add_theme_color_override("font_color", C_MUTED)
	legend_label.add_theme_font_size_override("font_size", 12)
	legend_label.add_theme_color_override("font_color", C_MUTED)
	result_title.add_theme_font_size_override("font_size", 38)
	result_title.add_theme_color_override("font_color", C_WIN)
	result_message.add_theme_font_size_override("font_size", 15)
	result_message.add_theme_color_override("font_color", C_MUTED)


func _style_containers() -> void:
	turn_panel.add_theme_stylebox_override("panel", _panel(C_PANEL_SOFT, 14, C_EDGE, 14, 6))

	var frame_style := _panel(Color(0.047, 0.067, 0.102), 20, C_EDGE, 10, 10)
	frame_style.shadow_color = Color(0.0, 0.0, 0.0, 0.35)
	frame_style.shadow_size = 16
	frame_style.shadow_offset = Vector2(0.0, 6.0)
	board_frame.add_theme_stylebox_override("panel", frame_style)

	var card_style := _panel(C_PANEL_SOFT, 24, Color(0.235, 0.310, 0.435), 40, 32)
	card_style.shadow_color = Color(0.0, 0.0, 0.0, 0.5)
	card_style.shadow_size = 32
	result_card.add_theme_stylebox_override("panel", card_style)


func _style_controls() -> void:
	for control in [restart_button, play_again_button, difficulty_picker]:
		control.focus_mode = Control.FOCUS_NONE

	_style_button(restart_button, C_PANEL_SOFT, C_EDGE, C_TEXT)
	_style_button(play_again_button, Color(0.153, 0.518, 0.831), Color(0.310, 0.667, 0.976), Color(1.0, 1.0, 1.0))

	_style_option(difficulty_picker)


func _style_button(button: Button, background: Color, border: Color, text_color: Color) -> void:
	button.add_theme_stylebox_override("normal", _button_box(background, border))
	button.add_theme_stylebox_override("hover", _button_box(background.lightened(0.08), border.lightened(0.10)))
	button.add_theme_stylebox_override("pressed", _button_box(background.darkened(0.12), border))
	button.add_theme_stylebox_override("focus", _button_box(background, border))
	button.add_theme_stylebox_override("disabled", _button_box(background.darkened(0.30), border))
	button.add_theme_color_override("font_color", text_color)
	button.add_theme_color_override("font_hover_color", text_color)
	button.add_theme_color_override("font_pressed_color", text_color)
	button.add_theme_color_override("font_focus_color", text_color)
	button.add_theme_font_size_override("font_size", 15)


func _style_option(option: OptionButton) -> void:
	option.add_theme_stylebox_override("normal", _button_box(C_PANEL_SOFT, C_EDGE))
	option.add_theme_stylebox_override("hover", _button_box(C_PANEL_SOFT.lightened(0.08), C_EDGE.lightened(0.10)))
	option.add_theme_stylebox_override("pressed", _button_box(C_PANEL_SOFT.darkened(0.10), C_EDGE))
	option.add_theme_stylebox_override("focus", _button_box(C_PANEL_SOFT, C_EDGE))
	option.add_theme_color_override("font_color", C_TEXT)
	option.add_theme_color_override("font_hover_color", C_TEXT)
	option.add_theme_color_override("font_pressed_color", C_TEXT)
	option.add_theme_font_size_override("font_size", 15)

	var popup := option.get_popup()
	popup.add_theme_color_override("font_color", C_TEXT)
	popup.add_theme_stylebox_override("panel", _panel(Color(0.078, 0.106, 0.157), 12, C_EDGE, 8, 8))
	popup.add_theme_stylebox_override("hover", _panel(Color(0.153, 0.212, 0.302), 8, Color(0, 0, 0, 0), 8, 4))


func _populate_difficulties() -> void:
	difficulty_picker.clear()
	for index in FugitiveAI.DIFFICULTY_NAMES.size():
		difficulty_picker.add_item(FugitiveAI.DIFFICULTY_NAMES[index], index)
		difficulty_picker.set_item_tooltip(index, FugitiveAI.DIFFICULTY_HINTS[index])


func _panel(background: Color, radius: int, border: Color, margin_h: int, margin_v: int) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = background
	style.border_color = border
	style.set_border_width_all(1)
	style.set_corner_radius_all(radius)
	style.content_margin_left = margin_h
	style.content_margin_right = margin_h
	style.content_margin_top = margin_v
	style.content_margin_bottom = margin_v
	style.anti_aliasing = true
	return style


func _button_box(background: Color, border: Color) -> StyleBoxFlat:
	return _panel(background, 12, border, 18, 11)


func _kill_overlay_tween() -> void:
	if _overlay_tween != null and _overlay_tween.is_valid():
		_overlay_tween.kill()
