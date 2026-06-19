import AppKit
import ApplicationServices
import AVFoundation
import CoreGraphics
import EventKit
import Foundation
import SwiftUI

enum PermissionKind: String, CaseIterable, Sendable {
	case screenCapture = "Screen Capture"
	case systemAudio = "System Audio Recording"
	case microphone = "Microphone Access"
	case accessibility = "Accessibility"
	case calendar = "Calendar Access"

	var title: String { rawValue }

	var description: String {
		switch self {
		case .screenCapture:
			return "Required to capture the screen for recordings and visual context."
		case .systemAudio:
			return "Required to capture system audio during recordings."
		case .microphone:
			return "Required to record microphone audio."
		case .accessibility:
			return "Required to control windows and run native macOS actions."
		case .calendar:
			return "Required to read and manage calendar events."
		}
	}

	var systemImage: String {
		switch self {
		case .screenCapture: return "display"
		case .systemAudio: return "speaker.wave.2"
		case .microphone: return "mic"
		case .accessibility: return "accessibility"
		case .calendar: return "calendar"
		}
	}

	var accentColor: Color {
		switch self {
		case .screenCapture: return Color(red: 0.20, green: 0.60, blue: 1.00)
		case .systemAudio: return Color(red: 1.00, green: 0.55, blue: 0.00)
		case .microphone: return Color(red: 1.00, green: 0.35, blue: 0.35)
		case .accessibility: return Color(red: 0.75, green: 0.40, blue: 0.95)
		case .calendar: return Color(red: 0.25, green: 0.75, blue: 0.45)
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

	func refresh() {
		statuses = PermissionKind.allCases.map { kind in
			PermissionStatus(kind: kind, isGranted: Self.checkStatus(for: kind))
		}
	}

	func request(_ kind: PermissionKind) async {
		switch kind {
		case .screenCapture, .systemAudio:
			_ = CGRequestScreenCaptureAccess()
		case .microphone:
			_ = await AVCaptureDevice.requestAccess(for: .audio)
		case .accessibility:
			let options: CFDictionary = ["AXTrustedCheckOptionPrompt": kCFBooleanTrue!] as CFDictionary
			_ = AXIsProcessTrustedWithOptions(options)
		case .calendar:
			let store = EKEventStore()
			if #available(macOS 14.0, *) {
				_ = try? await store.requestFullAccessToEvents()
			} else {
				_ = await withCheckedContinuation { continuation in
					store.requestAccess(to: .event) { granted, _ in
						continuation.resume(returning: granted)
					}
				}
			}
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
		case .accessibility:
			pane = "Privacy_Accessibility"
		case .calendar:
			pane = "Privacy_Calendars"
		}
		let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)")!
		NSWorkspace.shared.open(url)
	}

	private static func checkStatus(for kind: PermissionKind) -> Bool {
		switch kind {
		case .screenCapture, .systemAudio:
			return CGPreflightScreenCaptureAccess()
		case .microphone:
			return AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
		case .accessibility:
			return AXIsProcessTrusted()
		case .calendar:
			if #available(macOS 14.0, *) {
				return EKEventStore.authorizationStatus(for: .event) == .fullAccess
			} else {
				return EKEventStore.authorizationStatus(for: .event) == .authorized
			}
		}
	}
}
