enum SettingsSidebarIcon {
	static func systemName(for item: SettingsItem) -> String {
		let key = item.key.lowercased()
		let label = item.label.lowercased()

		// Top-level Settings toolbar tabs (exact keys first).
		switch key {
		case "appearance": return "paintpalette"
		case "chatinbound": return "bubble.left"
		case "defaults": return "slider.horizontal.3"
		case "ai": return "sparkles"
		case "transcription": return "pencil.and.scribble"
		case "websearch": return "magnifyingglass"
		case "weather": return "cloud.sun"
		case "dashboard": return "rectangle.3.group"
		default: break
		}

		if key == "personas" || key.hasPrefix("personas.") {
			return "person.crop.circle"
		}
		if key == "schedules" || key.hasPrefix("schedules.") {
			return "calendar"
		}
		if key == "skills" || key.hasPrefix("skills.") {
			return "wand.and.stars"
		}
		if key == "projects" || key.hasPrefix("projects.") {
			return "folder"
		}
		if key == "listen" || key.hasPrefix("listen.") {
			return "mic"
		}
		if key == "transcription" || key.hasPrefix("transcription.") {
			return "pencil.and.scribble"
		}
		if key == "websearch" || key.hasPrefix("websearch.") {
			return "magnifyingglass"
		}
		if key == "chatinbound" || key.hasPrefix("chatinbound.") {
			return "bubble.left"
		}
		if key == "weather" || key.hasPrefix("weather.") {
			return "cloud.sun"
		}
		if key == "dashboard" || key.hasPrefix("dashboard.") {
			return "rectangle.3.group"
		}
		if key == "defaults" || key.hasPrefix("defaults.") {
			return "slider.horizontal.3"
		}
		if key.hasPrefix("ai.") || key.contains(".ai.") || label.contains("model") || label.contains("provider") {
			return "cpu"
		}
		if label.contains("integration") || label.contains("plugin") {
			return "puzzlepiece.extension"
		}
		if label.contains("ai") {
			return "sparkles"
		}
		return "gearshape"
	}
}
