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

// MARK: - Chat transcript mode

/// How much pipeline detail the chat transcript shows.
/// Normal is conversation-only; debug includes tools, prep, and selection notices.
enum ChatTranscriptMode: String, CaseIterable, Identifiable, Sendable {
	case normal
	case debug

	var id: String { rawValue }

	var displayName: String {
		switch self {
		case .normal: "Normal"
		case .debug: "Debug"
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

// MARK: - Dashboard blocks

/// Home-dashboard cards the user can show or hide under Settings → Dashboard.
enum DashboardBlock: String, CaseIterable, Identifiable, Sendable {
	case email
	case tasks
	case calendar

	var id: String { rawValue }

	var displayName: String {
		switch self {
		case .email: "Unread mail"
		case .tasks: "Tasks"
		case .calendar: "Upcoming"
		}
	}

	var settingsTitle: String {
		switch self {
		case .email: "Show unread mail"
		case .tasks: "Show tasks"
		case .calendar: "Show upcoming events"
		}
	}

	var settingsDescription: String {
		switch self {
		case .email: "Show the unread mail card on the home dashboard. Stored only on this Mac."
		case .tasks: "Show the tasks card on the home dashboard. Stored only on this Mac."
		case .calendar:
			"Show the upcoming events card on the home dashboard. Stored only on this Mac."
		}
	}

	var accessibilityIdentifier: String {
		"dashboard-show-\(rawValue)-toggle"
	}

	/// UserDefaults key for this block's visibility preference.
	var defaultsKey: String {
		switch self {
		case .email: AppearanceDefaultsKey.showDashboardEmail
		case .tasks: AppearanceDefaultsKey.showDashboardTasks
		case .calendar: AppearanceDefaultsKey.showDashboardCalendar
		}
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
	/// Whether the unread-mail dashboard card is visible. Default on.
	static let showDashboardEmail = "toby.appearance.showDashboardEmail"
	/// Whether the tasks dashboard card is visible. Default on.
	static let showDashboardTasks = "toby.appearance.showDashboardTasks"
	/// Whether the upcoming-events dashboard card is visible. Default on.
	static let showDashboardCalendar = "toby.appearance.showDashboardCalendar"
	/// Open Toby automatically when this Mac logs in (Settings → General).
	static let launchAtLogin = "toby.general.launchAtLogin"
	/// Show the Toby status item in the menu bar (Settings → General). Default on.
	static let showMenuBarIcon = "toby.general.showMenuBarIcon"
	/// Chat transcript verbosity (Settings → General). Default normal.
	static let chatTranscriptMode = "toby.general.chatTranscriptMode"
	/// Last top-level tab visited in the Settings window. Defaults to General.
	static let settingsLastTab = "toby.general.settingsLastTab"
	/// System-wide shortcuts for global hotkey actions (JSON-encoded
	/// `[GlobalHotkeyAction: GlobalKeyboardShortcut]`). Empty until the user
	/// records shortcuts in Settings → General.
	static let globalShortcuts = "toby.general.globalShortcuts"
	/// Absolute path override for the Toby data directory (Settings → General).
	/// Empty / missing means default `~/.toby` (or `TOBY_DIR` when set externally).
	static let tobyDir = "toby.general.tobyDir"
}

/// Client-local preferences: theme, accent, startup, menu bar, and app-only
/// dashboard options (not daemon / `~/.toby` config).
@Observable
@MainActor
final class AppearancePreferences {
	static let shared = AppearancePreferences()

	static let modeDefaultsKey = AppearanceDefaultsKey.mode
	static let accentDefaultsKey = AppearanceDefaultsKey.accent
	static let hideOnboardingDefaultsKey = AppearanceDefaultsKey.hideOnboarding
	static let showDashboardEmailDefaultsKey = AppearanceDefaultsKey.showDashboardEmail
	static let showDashboardTasksDefaultsKey = AppearanceDefaultsKey.showDashboardTasks
	static let showDashboardCalendarDefaultsKey = AppearanceDefaultsKey.showDashboardCalendar
	static let launchAtLoginDefaultsKey = AppearanceDefaultsKey.launchAtLogin
	static let showMenuBarIconDefaultsKey = AppearanceDefaultsKey.showMenuBarIcon
	static let chatTranscriptModeDefaultsKey = AppearanceDefaultsKey.chatTranscriptMode
	static let globalShortcutsDefaultsKey = AppearanceDefaultsKey.globalShortcuts
	static let tobyDirDefaultsKey = AppearanceDefaultsKey.tobyDir

	/// Distributed notification posted when the user changes System Settings → Appearance.
	private static let systemThemeChanged = Notification.Name("AppleInterfaceThemeChangedNotification")

	private let defaults: UserDefaults
	/// Observer token; cleaned up when observation is replaced (singleton lives for app life).
	private var systemThemeObserver: NSObjectProtocol?
	private var isObservingSystemTheme = false
	/// When true, `launchAtLogin` didSet skips calling `SMAppService` (init / tests).
	private var suppressLaunchAtLoginSideEffects = false
	/// When true, `tobyDirOverride` didSet skips process environment sync (init).
	private var suppressTobyDirSideEffects = false

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

	/// When true, show the unread mail card on the home dashboard. Default is on.
	var showDashboardEmail: Bool {
		didSet {
			guard showDashboardEmail != oldValue else { return }
			defaults.set(showDashboardEmail, forKey: Self.showDashboardEmailDefaultsKey)
		}
	}

	/// When true, show the tasks card on the home dashboard. Default is on.
	var showDashboardTasks: Bool {
		didSet {
			guard showDashboardTasks != oldValue else { return }
			defaults.set(showDashboardTasks, forKey: Self.showDashboardTasksDefaultsKey)
		}
	}

	/// When true, show the upcoming events card on the home dashboard. Default is on.
	var showDashboardCalendar: Bool {
		didSet {
			guard showDashboardCalendar != oldValue else { return }
			defaults.set(showDashboardCalendar, forKey: Self.showDashboardCalendarDefaultsKey)
		}
	}

	/// Whether the given dashboard block should be visible on the home screen.
	func isDashboardBlockVisible(_ block: DashboardBlock) -> Bool {
		isDashboardBlockVisible(id: DashboardBlockID(block.rawValue))
	}

	/// Visibility by block id (registry / data-block API).
	func isDashboardBlockVisible(id: DashboardBlockID) -> Bool {
		switch id {
		case .email: showDashboardEmail
		case .tasks: showDashboardTasks
		case .calendar: showDashboardCalendar
		default:
			// Unknown future blocks default to visible until prefs exist.
			true
		}
	}

	/// Updates visibility for a dashboard block (used by Settings toggles).
	func setDashboardBlockVisible(_ block: DashboardBlock, visible: Bool) {
		setDashboardBlockVisible(id: DashboardBlockID(block.rawValue), visible: visible)
	}

	func setDashboardBlockVisible(id: DashboardBlockID, visible: Bool) {
		switch id {
		case .email: showDashboardEmail = visible
		case .tasks: showDashboardTasks = visible
		case .calendar: showDashboardCalendar = visible
		default:
			break
		}
	}

	/// Binding for a dashboard-block visibility toggle in Settings.
	/// Mutations run inside `withAnimation` so the home dashboard can transition
	/// sections in/out when the Settings window is open alongside it.
	func dashboardBlockVisibilityBinding(_ block: DashboardBlock) -> Binding<Bool> {
		Binding(
			get: { self.isDashboardBlockVisible(block) },
			set: { newValue in
				withAnimation(DashboardSectionMotion.animation) {
					self.setDashboardBlockVisible(block, visible: newValue)
				}
			}
		)
	}

	/// Binding for the hide-onboarding Settings toggle, animated like card visibility.
	var hideOnboardingBinding: Binding<Bool> {
		Binding(
			get: { self.hideOnboarding },
			set: { newValue in
				withAnimation(DashboardSectionMotion.animation) {
					self.hideOnboarding = newValue
				}
			}
		)
	}

	/// When true, Toby registers as a login item via `SMAppService.mainApp`.
	/// Default is off. Registration may require approval in System Settings.
	var launchAtLogin: Bool {
		didSet {
			guard launchAtLogin != oldValue else { return }
			defaults.set(launchAtLogin, forKey: Self.launchAtLoginDefaultsKey)
			guard !suppressLaunchAtLoginSideEffects else { return }
			applyLaunchAtLogin()
		}
	}

	/// Posted when `showMenuBarIcon` changes so AppKit menu bar chrome can update
	/// even if the change originated in another SwiftUI window scene.
	static let showMenuBarIconDidChange = Notification.Name("toby.showMenuBarIconDidChange")

	/// When true, show Toby’s icon in the menu bar. Default is on.
	var showMenuBarIcon: Bool {
		didSet {
			guard showMenuBarIcon != oldValue else { return }
			defaults.set(showMenuBarIcon, forKey: Self.showMenuBarIconDefaultsKey)
			// Only the live app singleton should drive menu bar chrome; test
			// fixtures use isolated UserDefaults and must not fling global events.
			guard self === AppearancePreferences.shared else { return }
			NotificationCenter.default.post(
				name: Self.showMenuBarIconDidChange,
				object: showMenuBarIcon
			)
		}
	}

	/// How much pipeline detail to show in the chat transcript. Default is normal.
	var chatTranscriptMode: ChatTranscriptMode {
		didSet {
			guard chatTranscriptMode != oldValue else { return }
			defaults.set(chatTranscriptMode.rawValue, forKey: Self.chatTranscriptModeDefaultsKey)
		}
	}

	/// Absolute path of a custom Toby data directory, or `nil` for the default
	/// (`~/.toby`). Stored only on this Mac; not part of daemon `config.json`.
	/// Changing this does not switch the live home by itself — callers must run
	/// the soft-reset orchestration (`ChatStore.switchTobyHome`).
	var tobyDirOverride: String? {
		didSet {
			guard !suppressTobyDirSideEffects else { return }
			let normalizedNew = Self.normalizedOverride(tobyDirOverride)
			let normalizedOld = Self.normalizedOverride(oldValue)
			guard normalizedNew != normalizedOld else { return }

			if let path = normalizedNew {
				defaults.set(path, forKey: Self.tobyDirDefaultsKey)
			} else {
				defaults.removeObject(forKey: Self.tobyDirDefaultsKey)
			}

			// Coalesce equivalent spellings into the canonical stored form.
			if tobyDirOverride != normalizedNew {
				suppressTobyDirSideEffects = true
				tobyDirOverride = normalizedNew
				suppressTobyDirSideEffects = false
			}

			guard self === AppearancePreferences.shared else { return }
			ConfigReader.syncTobyDirEnvironment(defaults: defaults)
		}
	}

	/// Resolved data directory currently in effect (env → preference → default).
	var resolvedTobyDir: String {
		ConfigReader.resolveTobyDir()
	}

	/// Whether a custom home path is stored in preferences (not merely env).
	var hasCustomTobyDirOverride: Bool {
		Self.normalizedOverride(tobyDirOverride) != nil
	}

	/// Posted when `globalShortcuts` changes so the global hotkey controller
	/// can re-register without holding a direct reference to prefs.
	static let globalShortcutsDidChange = Notification.Name("toby.globalShortcutsDidChange")

	/// System-wide keyboard shortcuts keyed by action. Empty until the user
	/// records shortcuts in Settings → General. Persisted as a JSON string.
	var globalShortcuts: [GlobalHotkeyAction: GlobalKeyboardShortcut] {
		didSet {
			guard globalShortcuts != oldValue else { return }
			if let data = try? JSONEncoder().encode(globalShortcuts),
				let value = String(data: data, encoding: .utf8)
			{
				defaults.set(value, forKey: Self.globalShortcutsDefaultsKey)
			} else {
				defaults.removeObject(forKey: Self.globalShortcutsDefaultsKey)
			}
			guard self === AppearancePreferences.shared else { return }
			NotificationCenter.default.post(name: Self.globalShortcutsDidChange, object: nil)
		}
	}

	/// Returns the shortcut for the given action, or nil if not set.
	func shortcut(for action: GlobalHotkeyAction) -> GlobalKeyboardShortcut? {
		globalShortcuts[action]
	}

	/// Sets or clears the shortcut for the given action.
	func setShortcut(_ shortcut: GlobalKeyboardShortcut?, for action: GlobalHotkeyAction) {
		var copy = globalShortcuts
		if let shortcut {
			copy[action] = shortcut
		} else {
			copy.removeValue(forKey: action)
		}
		globalShortcuts = copy
	}

	/// Last error from applying launch-at-login (shown in General settings).
	var launchAtLoginError: String?

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
		showDashboardEmail: Bool? = nil,
		showDashboardTasks: Bool? = nil,
		showDashboardCalendar: Bool? = nil,
		launchAtLogin: Bool? = nil,
		showMenuBarIcon: Bool? = nil,
		chatTranscriptMode: ChatTranscriptMode? = nil,
		globalShortcuts: [GlobalHotkeyAction: GlobalKeyboardShortcut]? = nil,
		tobyDirOverride: String? = nil,
		defaults: UserDefaults = .standard,
		applyLaunchAtLoginOnChange: Bool = true
	) {
		self.defaults = defaults
		// Suppress SMAppService during property init; apply explicitly when needed.
		self.suppressLaunchAtLoginSideEffects = true
		self.suppressTobyDirSideEffects = true

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

		// Default on when unset.
		let resolvedShowDashboardEmail: Bool
		if let showDashboardEmail {
			resolvedShowDashboardEmail = showDashboardEmail
		} else if defaults.object(forKey: Self.showDashboardEmailDefaultsKey) != nil {
			resolvedShowDashboardEmail = defaults.bool(forKey: Self.showDashboardEmailDefaultsKey)
		} else {
			resolvedShowDashboardEmail = true
		}

		let resolvedShowDashboardTasks: Bool
		if let showDashboardTasks {
			resolvedShowDashboardTasks = showDashboardTasks
		} else if defaults.object(forKey: Self.showDashboardTasksDefaultsKey) != nil {
			resolvedShowDashboardTasks = defaults.bool(forKey: Self.showDashboardTasksDefaultsKey)
		} else {
			resolvedShowDashboardTasks = true
		}

		let resolvedShowDashboardCalendar: Bool
		if let showDashboardCalendar {
			resolvedShowDashboardCalendar = showDashboardCalendar
		} else if defaults.object(forKey: Self.showDashboardCalendarDefaultsKey) != nil {
			resolvedShowDashboardCalendar = defaults.bool(forKey: Self.showDashboardCalendarDefaultsKey)
		} else {
			resolvedShowDashboardCalendar = true
		}

		// Default off when unset.
		let resolvedLaunchAtLogin: Bool
		if let launchAtLogin {
			resolvedLaunchAtLogin = launchAtLogin
		} else if defaults.object(forKey: Self.launchAtLoginDefaultsKey) != nil {
			resolvedLaunchAtLogin = defaults.bool(forKey: Self.launchAtLoginDefaultsKey)
		} else {
			resolvedLaunchAtLogin = false
		}

		// Default on when unset.
		let resolvedShowMenuBarIcon: Bool
		if let showMenuBarIcon {
			resolvedShowMenuBarIcon = showMenuBarIcon
		} else if defaults.object(forKey: Self.showMenuBarIconDefaultsKey) != nil {
			resolvedShowMenuBarIcon = defaults.bool(forKey: Self.showMenuBarIconDefaultsKey)
		} else {
			resolvedShowMenuBarIcon = true
		}

		// Default normal when unset.
		let resolvedChatTranscriptMode: ChatTranscriptMode
		if let chatTranscriptMode {
			resolvedChatTranscriptMode = chatTranscriptMode
		} else if let raw = defaults.string(forKey: Self.chatTranscriptModeDefaultsKey),
			let stored = ChatTranscriptMode(rawValue: raw)
		{
			resolvedChatTranscriptMode = stored
		} else {
			resolvedChatTranscriptMode = .normal
		}

		// Empty until the user records shortcuts.
		var resolvedGlobalShortcuts: [GlobalHotkeyAction: GlobalKeyboardShortcut] = [:]
		if let globalShortcuts {
			resolvedGlobalShortcuts = globalShortcuts
		} else if let raw = defaults.string(forKey: Self.globalShortcutsDefaultsKey),
			let data = raw.data(using: .utf8),
			let stored = try? JSONDecoder().decode(
				[GlobalHotkeyAction: GlobalKeyboardShortcut].self, from: data
			)
		{
			resolvedGlobalShortcuts = stored.filter { $0.value.hasRequiredModifiers }
		}

		let resolvedTobyDirOverride: String?
		if tobyDirOverride != nil {
			resolvedTobyDirOverride = Self.normalizedOverride(tobyDirOverride)
		} else {
			resolvedTobyDirOverride = Self.normalizedOverride(
				defaults.string(forKey: Self.tobyDirDefaultsKey)
			)
		}

		// Initialize all stored properties without touching self.mode first
		// (@Observable synthesis requires resolvedColorScheme before other uses).
		self.mode = resolvedMode
		self.accent = resolvedAccent
		self.hideOnboarding = resolvedHideOnboarding
		self.showDashboardEmail = resolvedShowDashboardEmail
		self.showDashboardTasks = resolvedShowDashboardTasks
		self.showDashboardCalendar = resolvedShowDashboardCalendar
		self.launchAtLogin = resolvedLaunchAtLogin
		self.showMenuBarIcon = resolvedShowMenuBarIcon
		self.chatTranscriptMode = resolvedChatTranscriptMode
		self.globalShortcuts = resolvedGlobalShortcuts
		self.tobyDirOverride = resolvedTobyDirOverride
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
		if showDashboardEmail != nil {
			defaults.set(resolvedShowDashboardEmail, forKey: Self.showDashboardEmailDefaultsKey)
		}
		if showDashboardTasks != nil {
			defaults.set(resolvedShowDashboardTasks, forKey: Self.showDashboardTasksDefaultsKey)
		}
		if showDashboardCalendar != nil {
			defaults.set(resolvedShowDashboardCalendar, forKey: Self.showDashboardCalendarDefaultsKey)
		}
		if launchAtLogin != nil {
			defaults.set(resolvedLaunchAtLogin, forKey: Self.launchAtLoginDefaultsKey)
		}
		if showMenuBarIcon != nil {
			defaults.set(resolvedShowMenuBarIcon, forKey: Self.showMenuBarIconDefaultsKey)
		}
		if chatTranscriptMode != nil {
			defaults.set(resolvedChatTranscriptMode.rawValue, forKey: Self.chatTranscriptModeDefaultsKey)
		}
		if globalShortcuts != nil, let data = try? JSONEncoder().encode(resolvedGlobalShortcuts),
			let value = String(data: data, encoding: .utf8)
		{
			defaults.set(value, forKey: Self.globalShortcutsDefaultsKey)
		}
		if tobyDirOverride != nil {
			if let path = resolvedTobyDirOverride {
				defaults.set(path, forKey: Self.tobyDirDefaultsKey)
			} else {
				defaults.removeObject(forKey: Self.tobyDirDefaultsKey)
			}
		}

		self.suppressLaunchAtLoginSideEffects = !applyLaunchAtLoginOnChange
		self.suppressTobyDirSideEffects = false
	}

	/// Apply the stored home-directory preference to the process environment.
	/// Call once at app launch before daemon bootstrap / native server start.
	static func applyStoredTobyDirEnvironment() {
		ConfigReader.syncTobyDirEnvironment()
	}

	/// Normalize an override path: trim, standardize, treat empty as `nil`.
	static func normalizedOverride(_ path: String?) -> String? {
		guard let path else { return nil }
		let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return nil }
		return ConfigReader.standardizePath(trimmed)
	}

	/// Applies the stored launch-at-login preference to the system login item.
	func applyLaunchAtLogin() {
		let result = LaunchAtLogin.setEnabled(launchAtLogin)
		switch result {
		case .success:
			if launchAtLogin, LaunchAtLogin.requiresApproval {
				launchAtLoginError =
					"Toby is waiting for approval in System Settings → General → Login Items."
			} else {
				launchAtLoginError = nil
			}
		case .failure(let error):
			launchAtLoginError = error.localizedDescription
			// Keep the preference as the user set it so a later signed install
			// can honor it; surface the error in Settings instead of silently
			// flipping the toggle.
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
