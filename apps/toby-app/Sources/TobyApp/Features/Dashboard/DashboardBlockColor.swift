import AppKit
import SwiftUI

/// Home-specific appearance. `nil` inherits; "neutral" explicitly removes a tint.
enum DashboardBlockColor {
	static func validated(_ id: String?) -> String? {
		guard let id else { return nil }
		return id == "neutral" || AccentPreset(rawValue: id) != nil ? id : nil
	}

	static func border(_ id: String?) -> Color {
		id.flatMap(AccentPreset.init(rawValue:))?.color ?? AppTheme.separator
	}

	/// Opaque blend shared by the card and its overflow fade. Dynamic colors
	/// resolve against the view's appearance, including an explicit app theme.
	static func background(_ id: String?) -> Color {
		Color(nsColor: backgroundNSColor(id))
	}

	static func backgroundNSColor(_ id: String?) -> NSColor {
		guard let preset = id.flatMap(AccentPreset.init(rawValue:)) else {
			return .tobyContentBackground
		}
		return NSColor(name: "toby.home.\(preset.rawValue)") { appearance in
			let dark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
			var base = NSColor.tobyContentBackground
			appearance.performAsCurrentDrawingAppearance {
				base = NSColor.tobyContentBackground.usingColorSpace(.sRGB) ?? base
			}
			return base.blended(withFraction: dark ? 0.12 : 0.07, of: preset.nsColor) ?? base
		}
	}
}

extension EnvironmentValues {
	@Entry var dashboardBlockColor: String? = nil
}

/// Shared named palette for flow output defaults and Home overrides.
struct DashboardColorPicker: View {
	@Binding var selection: String
	var defaultLabel = "Use default"

	var body: some View {
		Picker("Home color", selection: $selection) {
			Text(defaultLabel).tag("")
			Text("Neutral").tag("neutral")
			ForEach(FlowColorOption.all) { option in
				Text(option.label).tag(option.id)
			}
		}
	}
}
