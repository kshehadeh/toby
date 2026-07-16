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
}

// MARK: - Theme resolution (mode → concrete light/dark)

/// Resolves the user's appearance mode to a concrete light/dark scheme.
/// System mode reads the macOS setting rather than leaving SwiftUI "unspecified".
enum ThemeResolution {
	/// Whether chrome should use the dark palette right now.
	static var isDark: Bool {
		switch currentMode {
		case .light: false
		case .dark: true
		case .system: systemIsDark()
		}
	}

	static var colorScheme: ColorScheme {
		isDark ? .dark : .light
	}

	static var currentMode: AppearanceMode {
		let raw = UserDefaults.standard.string(forKey: AppearanceDefaultsKey.mode)
		return raw.flatMap(AppearanceMode.init(rawValue:)) ?? .system
	}

	/// Detects the macOS appearance preference (including Auto / schedule flips).
	///
	/// Uses `AppleInterfaceStyle` so this stays nonisolated-safe for `AppTheme`
	/// token evaluation. The key is `"Dark"` in dark mode and absent in light;
	/// Auto schedule updates the key and posts `AppleInterfaceThemeChangedNotification`.
	static func systemIsDark() -> Bool {
		guard let style = UserDefaults.standard.string(forKey: "AppleInterfaceStyle") else {
			return false
		}
		return style.caseInsensitiveCompare("Dark") == .orderedSame
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

/// UserDefaults keys for client-local app preferences
/// (nonisolated for use from `AppTheme.accent`).
enum AppearanceDefaultsKey {
	static let mode = "toby.appearance.mode"
	static let accent = "toby.appearance.accent"
	/// Dashboard onboarding visibility (Settings → Dashboard; still app-local).
	static let hideOnboarding = "toby.appearance.hideOnboarding"
}

/// Client-local preferences: theme, accent, and app-only dashboard options
/// (not daemon / `~/.toby` config).
@Observable
@MainActor
final class AppearancePreferences {
	static let shared = AppearancePreferences()

	static let modeDefaultsKey = AppearanceDefaultsKey.mode
	static let accentDefaultsKey = AppearanceDefaultsKey.accent
	static let hideOnboardingDefaultsKey = AppearanceDefaultsKey.hideOnboarding

	/// Distributed notification posted when the user changes System Settings → Appearance.
	private static let systemThemeChanged = Notification.Name("AppleInterfaceThemeChangedNotification")

	private let defaults: UserDefaults
	/// Observer token; cleaned up when observation is replaced (singleton lives for app life).
	private var systemThemeObserver: NSObjectProtocol?
	private var isObservingSystemTheme = false

	var mode: AppearanceMode {
		didSet {
			guard mode != oldValue else { return }
			defaults.set(mode.rawValue, forKey: Self.modeDefaultsKey)
			refreshResolvedColorScheme()
			applyToApp()
		}
	}

	var accent: AccentPreset {
		didSet {
			guard accent != oldValue else { return }
			defaults.set(accent.rawValue, forKey: Self.accentDefaultsKey)
			themeEpoch &+= 1
		}
	}

	/// When true, the dashboard onboarding checklist is hidden even if incomplete.
	var hideOnboarding: Bool {
		didSet {
			guard hideOnboarding != oldValue else { return }
			defaults.set(hideOnboarding, forKey: Self.hideOnboardingDefaultsKey)
		}
	}

	/// Concrete light/dark currently applied. System mode mirrors macOS.
	/// Always light or dark — never "unspecified" — so SwiftUI theme tokens flip.
	var resolvedColorScheme: ColorScheme

	/// Bumped when scheme or accent changes so sticky subtrees (lists, form
	/// rows) can re-identity via `tobyThemeRefreshable()` without resetting
	/// window-level `@State` (e.g. Settings tab selection).
	var themeEpoch: Int = 0

	/// Explicit scheme forced onto SwiftUI. Always the resolved light/dark value.
	var preferredColorScheme: ColorScheme { resolvedColorScheme }

	var accentColor: Color { accent.color }

	/// `NSApp.appearance` override: forced for light/dark; `nil` for system so
	/// native chrome tracks the OS while we still resolve tokens via `resolvedColorScheme`.
	var nsAppearance: NSAppearance? {
		switch mode {
		case .system: nil
		case .light: NSAppearance(named: .aqua)
		case .dark: NSAppearance(named: .darkAqua)
		}
	}

	init(
		mode: AppearanceMode? = nil,
		accent: AccentPreset? = nil,
		hideOnboarding: Bool? = nil,
		defaults: UserDefaults = .standard
	) {
		self.defaults = defaults

		let resolvedMode: AppearanceMode
		if let mode {
			resolvedMode = mode
		} else if let raw = defaults.string(forKey: Self.modeDefaultsKey),
			let stored = AppearanceMode(rawValue: raw)
		{
			resolvedMode = stored
		} else {
			resolvedMode = .system
		}

		let resolvedAccent: AccentPreset
		if let accent {
			resolvedAccent = accent
		} else if let raw = defaults.string(forKey: Self.accentDefaultsKey),
			let stored = AccentPreset(rawValue: raw)
		{
			resolvedAccent = stored
		} else {
			resolvedAccent = .orange
		}

		let resolvedHideOnboarding: Bool
		if let hideOnboarding {
			resolvedHideOnboarding = hideOnboarding
		} else if defaults.object(forKey: Self.hideOnboardingDefaultsKey) != nil {
			resolvedHideOnboarding = defaults.bool(forKey: Self.hideOnboardingDefaultsKey)
		} else {
			resolvedHideOnboarding = false
		}

		// Initialize all stored properties without touching self.mode first
		// (@Observable synthesis requires resolvedColorScheme before other uses).
		self.mode = resolvedMode
		self.accent = resolvedAccent
		self.hideOnboarding = resolvedHideOnboarding
		self.resolvedColorScheme = Self.resolveColorScheme(for: resolvedMode)

		// When explicit values are passed, persist them so reloads see them.
		if mode != nil {
			defaults.set(resolvedMode.rawValue, forKey: Self.modeDefaultsKey)
		}
		if accent != nil {
			defaults.set(resolvedAccent.rawValue, forKey: Self.accentDefaultsKey)
		}
		if hideOnboarding != nil {
			defaults.set(resolvedHideOnboarding, forKey: Self.hideOnboardingDefaultsKey)
		}
	}

	/// Recompute light/dark from mode + (when system) the macOS setting.
	func refreshResolvedColorScheme() {
		let next = Self.resolveColorScheme(for: mode)
		if resolvedColorScheme != next {
			resolvedColorScheme = next
			themeEpoch &+= 1
		}
	}

	static func resolveColorScheme(for mode: AppearanceMode) -> ColorScheme {
		switch mode {
		case .light: .light
		case .dark: .dark
		case .system: ThemeResolution.systemIsDark() ? .dark : .light
		}
	}

	/// Push the selected appearance onto `NSApp` so AppKit views update.
	/// Safe when `NSApp` is not yet created (e.g. unit tests).
	func applyToApp() {
		guard let app = NSApp else { return }
		app.appearance = nsAppearance
	}

	/// Observe System Settings appearance changes while mode is System.
	func startObservingSystemAppearanceIfNeeded() {
		guard !isObservingSystemTheme else { return }
		isObservingSystemTheme = true
		systemThemeObserver = DistributedNotificationCenter.default().addObserver(
			forName: Self.systemThemeChanged,
			object: nil,
			queue: .main
		) { [weak self] _ in
			Task { @MainActor in
				guard let self else { return }
				// Only System mode should track OS flips; light/dark stay fixed.
				guard self.mode == .system else { return }
				self.refreshResolvedColorScheme()
				self.applyToApp()
			}
		}
	}
}

// MARK: - Theme epoch environment

private struct TobyThemeEpochKey: EnvironmentKey {
	static let defaultValue: Int = 0
}

extension EnvironmentValues {
	/// Increments when appearance mode/scheme or accent changes.
	var tobyThemeEpoch: Int {
		get { self[TobyThemeEpochKey.self] }
		set { self[TobyThemeEpochKey.self] = newValue }
	}
}

// MARK: - View helpers

extension View {
	/// Applies Toby appearance preferences to a window root.
	///
	/// System mode is resolved to an explicit light or dark scheme so custom
	/// `AppTheme` tokens follow the OS — not only native stoplights.
	func tobyAppearance(_ prefs: AppearancePreferences) -> some View {
		self
			// Always an explicit light/dark so dynamic colors and SwiftUI chrome follow.
			// Do NOT use `.id(resolvedColorScheme)` on the window root — that resets
			// Settings tab state. Sticky lists use `tobyThemeRefreshable()` instead.
			.preferredColorScheme(prefs.resolvedColorScheme)
			.environment(prefs)
			.environment(\.tobyThemeEpoch, prefs.themeEpoch)
			.tint(prefs.accentColor)
			.onAppear {
				prefs.startObservingSystemAppearanceIfNeeded()
				prefs.refreshResolvedColorScheme()
				prefs.applyToApp()
			}
			.onChange(of: prefs.mode) { _, _ in
				prefs.refreshResolvedColorScheme()
				prefs.applyToApp()
			}
			.onChange(of: prefs.resolvedColorScheme) { _, _ in
				prefs.applyToApp()
			}
	}

	/// Re-identifies this subtree when the theme epoch changes so Lazy stacks,
	/// session rows, and form labels re-evaluate colors — without resetting
	/// ancestor `@State` (navigation, Settings tabs).
	func tobyThemeRefreshable() -> some View {
		modifier(TobyThemeRefreshModifier())
	}
}

private struct TobyThemeRefreshModifier: ViewModifier {
	@Environment(\.tobyThemeEpoch) private var themeEpoch
	@Environment(\.colorScheme) private var colorScheme

	func body(content: Content) -> some View {
		content.id("toby-theme-\(themeEpoch)-\(colorScheme)")
	}
}
