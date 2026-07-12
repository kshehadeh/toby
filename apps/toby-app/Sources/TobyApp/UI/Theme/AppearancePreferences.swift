import AppKit
import SwiftUI

// MARK: - Appearance mode

enum AppearanceMode: String, CaseIterable, Identifiable, Sendable {
	case system
	case light
	case dark

	var id: String { rawValue }

	var displayName: String {
		switch self {
		case .system: "System"
		case .light: "Light"
		case .dark: "Dark"
		}
	}

	/// `nil` means follow the system appearance.
	var preferredColorScheme: ColorScheme? {
		switch self {
		case .system: nil
		case .light: .light
		case .dark: .dark
		}
	}

	/// `nil` means follow the system appearance.
	var nsAppearance: NSAppearance? {
		switch self {
		case .system: nil
		case .light: NSAppearance(named: .aqua)
		case .dark: NSAppearance(named: .darkAqua)
		}
	}
}

// MARK: - Accent presets

enum AccentPreset: String, CaseIterable, Identifiable, Sendable {
	case orange
	case blue
	case green
	case purple
	case pink
	case red
	case teal
	case gray

	var id: String { rawValue }

	var displayName: String {
		switch self {
		case .orange: "Orange"
		case .blue: "Blue"
		case .green: "Green"
		case .purple: "Purple"
		case .pink: "Pink"
		case .red: "Red"
		case .teal: "Teal"
		case .gray: "Gray"
		}
	}

	/// Fixed RGB for the accent (same in light and dark).
	var color: Color {
		switch self {
		case .orange: Color(red: 0.96, green: 0.62, blue: 0.12)
		case .blue: Color(red: 0.25, green: 0.55, blue: 0.95)
		case .green: Color(red: 0.25, green: 0.75, blue: 0.45)
		case .purple: Color(red: 0.62, green: 0.42, blue: 0.95)
		case .pink: Color(red: 0.92, green: 0.40, blue: 0.65)
		case .red: Color(red: 0.90, green: 0.35, blue: 0.35)
		case .teal: Color(red: 0.20, green: 0.72, blue: 0.72)
		case .gray: Color(red: 0.55, green: 0.58, blue: 0.62)
		}
	}

	var nsColor: NSColor {
		switch self {
		case .orange: NSColor(calibratedRed: 0.96, green: 0.62, blue: 0.12, alpha: 1)
		case .blue: NSColor(calibratedRed: 0.25, green: 0.55, blue: 0.95, alpha: 1)
		case .green: NSColor(calibratedRed: 0.25, green: 0.75, blue: 0.45, alpha: 1)
		case .purple: NSColor(calibratedRed: 0.62, green: 0.42, blue: 0.95, alpha: 1)
		case .pink: NSColor(calibratedRed: 0.92, green: 0.40, blue: 0.65, alpha: 1)
		case .red: NSColor(calibratedRed: 0.90, green: 0.35, blue: 0.35, alpha: 1)
		case .teal: NSColor(calibratedRed: 0.20, green: 0.72, blue: 0.72, alpha: 1)
		case .gray: NSColor(calibratedRed: 0.55, green: 0.58, blue: 0.62, alpha: 1)
		}
	}

	/// Resolves the persisted accent (or default orange) without MainActor.
	static var current: AccentPreset {
		let raw = UserDefaults.standard.string(forKey: AppearanceDefaultsKey.accent)
		return raw.flatMap(AccentPreset.init(rawValue:)) ?? .orange
	}
}

// MARK: - Preferences store

/// UserDefaults keys for appearance (nonisolated for use from `AppTheme.accent`).
enum AppearanceDefaultsKey {
	static let mode = "toby.appearance.mode"
	static let accent = "toby.appearance.accent"
}

/// Client-local appearance preferences (not daemon / `~/.toby` config).
@Observable
@MainActor
final class AppearancePreferences {
	static let shared = AppearancePreferences()

	static let modeDefaultsKey = AppearanceDefaultsKey.mode
	static let accentDefaultsKey = AppearanceDefaultsKey.accent

	private let defaults: UserDefaults

	var mode: AppearanceMode {
		didSet {
			guard mode != oldValue else { return }
			defaults.set(mode.rawValue, forKey: Self.modeDefaultsKey)
			applyToApp()
		}
	}

	var accent: AccentPreset {
		didSet {
			guard accent != oldValue else { return }
			defaults.set(accent.rawValue, forKey: Self.accentDefaultsKey)
		}
	}

	var preferredColorScheme: ColorScheme? { mode.preferredColorScheme }

	var nsAppearance: NSAppearance? { mode.nsAppearance }

	var accentColor: Color { accent.color }

	init(
		mode: AppearanceMode? = nil,
		accent: AccentPreset? = nil,
		defaults: UserDefaults = .standard
	) {
		self.defaults = defaults

		if let mode {
			self.mode = mode
		} else if let raw = defaults.string(forKey: Self.modeDefaultsKey),
			let stored = AppearanceMode(rawValue: raw)
		{
			self.mode = stored
		} else {
			self.mode = .system
		}

		if let accent {
			self.accent = accent
		} else if let raw = defaults.string(forKey: Self.accentDefaultsKey),
			let stored = AccentPreset(rawValue: raw)
		{
			self.accent = stored
		} else {
			self.accent = .orange
		}

		// When explicit values are passed, persist them so reloads see them.
		if mode != nil {
			defaults.set(self.mode.rawValue, forKey: Self.modeDefaultsKey)
		}
		if accent != nil {
			defaults.set(self.accent.rawValue, forKey: Self.accentDefaultsKey)
		}
	}

	/// Push the selected appearance onto `NSApp` so AppKit views and dynamic colors update.
	/// Safe when `NSApp` is not yet created (e.g. unit tests).
	func applyToApp() {
		guard let app = NSApp else { return }
		app.appearance = nsAppearance
	}
}

// MARK: - View helper

extension View {
	/// Applies Toby appearance preferences to a window root.
	func tobyAppearance(_ prefs: AppearancePreferences) -> some View {
		self
			.preferredColorScheme(prefs.preferredColorScheme)
			.environment(prefs)
			.tint(prefs.accentColor)
			.onAppear { prefs.applyToApp() }
			.onChange(of: prefs.mode) { _, _ in
				prefs.applyToApp()
			}
	}
}
