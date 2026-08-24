import AppKit
import ApplicationServices
import AVFoundation
import CoreGraphics
import CoreLocation
import EventKit
import Foundation
import SwiftUI

enum PermissionKind: String, CaseIterable, Sendable {
	case screenCapture = "Screen Capture"
	case systemAudio = "System Audio Recording"
	case microphone = "Microphone Access"
	case location = "Location Access"
	case accessibility = "Accessibility"
	case calendar = "Calendar Access"
	case reminders = "Reminders Access"

	var title: String { rawValue }

	var description: String {
		switch self {
		case .screenCapture:
			return "Required to capture the screen for recordings and visual context."
		case .systemAudio:
			return "Required to capture system audio during recordings."
		case .microphone:
			return "Required to record microphone audio."
		case .location:
			return "Required to determine your current location for location-aware chat."
		case .accessibility:
			return "Required to control windows and run native macOS actions."
		case .calendar:
			return "Required to read and manage calendar events."
		case .reminders:
			return "Required to read and manage reminders."
		}
	}

	var systemImage: String {
		switch self {
		case .screenCapture: return "display"
		case .systemAudio: return "speaker.wave.2"
		case .microphone: return "mic"
		case .location: return "location"
		case .accessibility: return "accessibility"
		case .calendar: return "calendar"
		case .reminders: return "checklist"
		}
	}

	var accentColor: Color {
		switch self {
		case .screenCapture: return Color(red: 0.20, green: 0.60, blue: 1.00)
		case .systemAudio: return Color(red: 1.00, green: 0.55, blue: 0.00)
		case .microphone: return Color(red: 1.00, green: 0.35, blue: 0.35)
		case .location: return Color(red: 0.15, green: 0.70, blue: 0.85)
		case .accessibility: return Color(red: 0.75, green: 0.40, blue: 0.95)
		case .calendar: return Color(red: 0.25, green: 0.75, blue: 0.45)
		case .reminders: return Color(red: 0.20, green: 0.55, blue: 0.95)
		}
	}
}

struct PermissionStatus: Identifiable, Sendable {
	let kind: PermissionKind
	var isGranted: Bool

	var id: String { kind.rawValue }
}

@MainActor
@Observable
final class PermissionsStore {
	private(set) var statuses: [PermissionStatus] = PermissionKind.allCases.map { PermissionStatus(kind: $0, isGranted: false) }
	/// False until the first `refresh()` so callers can avoid treating the
	/// all-denied initial defaults as real permission state (e.g. onboarding).
	private(set) var hasRefreshedOnce = false
	/// Held so Location Services authorization callbacks stay associated with this process.
	private let locationManager = CLLocationManager()

	func refresh() {
		statuses = PermissionKind.allCases.map { kind in
			PermissionStatus(kind: kind, isGranted: Self.checkStatus(for: kind, locationManager: locationManager))
		}
		hasRefreshedOnce = true
	}

	func request(_ kind: PermissionKind) async {
		switch kind {
		case .screenCapture, .systemAudio:
			_ = CGRequestScreenCaptureAccess()
		case .microphone:
			_ = await AVAudioApplication.requestRecordPermission()
		case .location:
			let status = locationManager.authorizationStatus
			if status == .notDetermined {
				locationManager.requestWhenInUseAuthorization()
			} else if status == .denied || status == .restricted {
				// Already decided — only System Settings can re-enable.
				break
			}
		case .accessibility:
			let options: CFDictionary = ["AXTrustedCheckOptionPrompt": kCFBooleanTrue!] as CFDictionary
			_ = AXIsProcessTrustedWithOptions(options)
		case .calendar:
			let store = EKEventStore()
			_ = try? await store.requestFullAccessToEvents()
		case .reminders:
			let store = EKEventStore()
			_ = try? await store.requestFullAccessToReminders()
		}
		// macOS permission dialogs are asynchronous from the OS perspective; give the user a moment
		// to answer before re-checking, and then re-check once more when the app returns to foreground.
		try? await Task.sleep(nanoseconds: 500_000_000)
		refresh()
	}

	func openPrivacySettings(for kind: PermissionKind) {
		let pane: String
		switch kind {
		case .screenCapture, .systemAudio:
			pane = "Privacy_ScreenCapture"
		case .microphone:
			pane = "Privacy_Microphone"
		case .location:
			pane = "Privacy_LocationServices"
		case .accessibility:
			pane = "Privacy_Accessibility"
		case .calendar:
			pane = "Privacy_Calendars"
		case .reminders:
			pane = "Privacy_Reminders"
		}
		let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)")!
		NSWorkspace.shared.open(url)
	}

	private static func checkStatus(for kind: PermissionKind, locationManager: CLLocationManager) -> Bool {
		switch kind {
		case .screenCapture, .systemAudio:
			return CGPreflightScreenCaptureAccess()
		case .microphone:
			return AVAudioApplication.shared.recordPermission == .granted
		case .location:
			guard CLLocationManager.locationServicesEnabled() else { return false }
			switch locationManager.authorizationStatus {
			case .authorizedAlways, .authorizedWhenInUse:
				return true
			default:
				return false
			}
		case .accessibility:
			return AXIsProcessTrusted()
		case .calendar:
			return EKEventStore.authorizationStatus(for: .event) == .fullAccess
		case .reminders:
			return EKEventStore.authorizationStatus(for: .reminder) == .fullAccess
		}
	}
}
