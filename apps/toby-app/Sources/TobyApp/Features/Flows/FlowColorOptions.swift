import SwiftUI

struct FlowColorOption: Identifiable, Equatable {
	let preset: AccentPreset

	var id: String { preset.rawValue }
	var label: String { preset.displayName }
	var color: Color { preset.color }

	static let defaultId = AccentPreset.teal.rawValue

	/// Teal first (custom-flow default). Ids must match `FLOW_TILE_COLORS` in `@toby/core`.
	static let all: [FlowColorOption] = [
		FlowColorOption(preset: .teal),
		FlowColorOption(preset: .blue),
		FlowColorOption(preset: .green),
		FlowColorOption(preset: .orange),
		FlowColorOption(preset: .purple),
		FlowColorOption(preset: .pink),
		FlowColorOption(preset: .red),
		FlowColorOption(preset: .gray),
	]

	static func resolved(_ id: String?, fallback: String = defaultId) -> FlowColorOption {
		if let id, let preset = AccentPreset(rawValue: id) {
			return FlowColorOption(preset: preset)
		}
		if let preset = AccentPreset(rawValue: fallback) {
			return FlowColorOption(preset: preset)
		}
		return FlowColorOption(preset: .teal)
	}

	static func resolvedId(_ id: String?, fallback: String = defaultId) -> String {
		resolved(id, fallback: fallback).id
	}
}
