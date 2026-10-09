import AppKit

/// Session-only focus history. A launch date prevents PID reuse from inheriting history.
struct AppFocusHistory {
	struct Process: Hashable {
		let identifier: pid_t
		let launchDate: Date?
	}

	private var lastFocused: [Process: Date] = [:]

	mutating func record(_ process: Process, at date: Date) {
		lastFocused[process] = date
	}

	mutating func remove(_ process: Process) {
		lastFocused.removeValue(forKey: process)
	}

	func secondsSinceFocus(_ process: Process, isActive: Bool, now: Date) -> TimeInterval? {
		if isActive { return 0 }
		return lastFocused[process].map { max(0, now.timeIntervalSince($0)) }
	}
}

@MainActor
final class NativeAppFocusTracker: NSObject {
	static let shared = NativeAppFocusTracker()
	private var history = AppFocusHistory()
	private var started = false

	func start() {
		guard !started else { return }
		started = true
		let center = NSWorkspace.shared.notificationCenter
		for name in [NSWorkspace.didActivateApplicationNotification, NSWorkspace.didDeactivateApplicationNotification] {
			center.addObserver(self, selector: #selector(focusChanged(_:)), name: name, object: nil)
		}
		center.addObserver(self, selector: #selector(appTerminated(_:)), name: NSWorkspace.didTerminateApplicationNotification, object: nil)
		if let app = NSWorkspace.shared.frontmostApplication {
			history.record(process(app), at: Date())
		}
	}

	func secondsSinceFocus(_ app: NSRunningApplication) -> TimeInterval? {
		history.secondsSinceFocus(process(app), isActive: app.isActive, now: Date())
	}

	@objc private func focusChanged(_ notification: Notification) {
		guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
		// Deactivation marks the end of the most recent interval with focus.
		history.record(process(app), at: Date())
	}

	@objc private func appTerminated(_ notification: Notification) {
		guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
		history.remove(process(app))
	}

	private func process(_ app: NSRunningApplication) -> AppFocusHistory.Process {
		.init(identifier: app.processIdentifier, launchDate: app.launchDate)
	}
}
