enum SettingsSidebarIcon {
	static func systemName(for item: SettingsItem) -> String {
		let key = item.key.lowercased()
		let label = item.label.lowercased()

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
		if key.contains(".ai.") || label.contains("model") || label.contains("provider") {
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
