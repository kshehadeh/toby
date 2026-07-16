import AppKit
import ServiceManagement

/// Wraps `SMAppService.mainApp` so Toby can open at login.
///
/// Requires a properly installed/signed app bundle for registration to succeed.
/// Ad-hoc local builds may fail; callers should handle errors and
/// `requiresApproval` (user must allow Toby under Login Items).
enum LaunchAtLogin {
	static var status: SMAppService.Status {
		SMAppService.mainApp.status
	}

	static var isEnabled: Bool {
		status == .enabled
	}

	/// Whether the system is waiting for the user to approve Toby in Login Items.
	static var requiresApproval: Bool {
		status == .requiresApproval
	}

	@discardableResult
	static func setEnabled(_ enabled: Bool) -> Result<Void, Error> {
		do {
			if enabled {
				switch SMAppService.mainApp.status {
				case .enabled:
					return .success(())
				case .requiresApproval:
					// Already registered; user must approve in System Settings.
					return .success(())
				default:
					try SMAppService.mainApp.register()
				}
			} else {
				switch SMAppService.mainApp.status {
				case .notRegistered:
					return .success(())
				default:
					try SMAppService.mainApp.unregister()
				}
			}
			return .success(())
		} catch {
			return .failure(error)
		}
	}

	/// Opens System Settings → General → Login Items when approval is needed.
	static func openLoginItemsSettings() {
		if let url = URL(string: "x-apple.systempreferences:com.apple.LoginItems-Settings.extension") {
			NSWorkspace.shared.open(url)
		}
	}
}
