import AppKit
import Foundation
@preconcurrency import QuickLookUI

/// Helpers for previewing files with macOS Quick Look.
enum FileQuickLook {
	/// File URL suitable for Quick Look, or `nil` when the path is missing or a directory.
	static func previewURL(for path: String) -> URL? {
		let url = URL(fileURLWithPath: path)
		var isDirectory: ObjCBool = false
		guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory),
		      !isDirectory.boolValue
		else {
			return nil
		}
		return url.standardizedFileURL
	}

	/// Prefer Quick Look for an existing file; otherwise open with the default app.
	///
	/// Callers that drive SwiftUI's `.quickLookPreview` should apply `url` on a
	/// later turn. Setting it during the context-menu update opens the panel
	/// inside `NSHostingView.layout` and crashes.
	@MainActor
	static func previewOrOpen(path: String, setPreviewURL: (URL?) -> Void) {
		if let url = previewURL(for: path) {
			setPreviewURL(url)
		} else {
			RevealInFinder.openWithDefaultApp(path: path)
		}
	}

	/// Open Quick Look after the current SwiftUI update. Use this instead of
	/// `.quickLookPreview` when the action comes from a control that is laying
	/// out in the same turn (the library icon grid).
	@MainActor
	static func present(path: String) {
		guard let url = previewURL(for: path) else {
			RevealInFinder.openWithDefaultApp(path: path)
			return
		}
		QuickLookPanelController.shared.stage(url)
		DispatchQueue.main.async {
			MainActor.assumeIsolated {
				QuickLookPanelController.shared.openPanel()
			}
		}
	}
}

/// AppKit Quick Look panel. SwiftUI's `.quickLookPreview` presents from inside
/// the display cycle; `QLPreviewView` then runs the event loop and UpdateCycle
/// jumps to a null return handler. Opening the shared panel on the next turn
/// avoids that re-entry.
final class QuickLookPanelController: NSResponder, QLPreviewPanelDataSource {
	static let shared = QuickLookPanelController()

	private var url: URL?

	/// The file that will be shown. Tests inspect this without opening the panel.
	@MainActor
	var stagedURL: URL? { url }

	@MainActor
	func stage(_ url: URL) {
		self.url = url.standardizedFileURL
	}

	/// Quick Look calls the panel on the main thread. `assumeIsolated` matches that.
	@MainActor
	func openPanel() {
		guard url != nil else { return }
		attachToResponderChain()
		guard let panel = QLPreviewPanel.shared() else { return }
		panel.updateController()
		if panel.isVisible {
			panel.reloadData()
		} else {
			panel.makeKeyAndOrderFront(nil)
		}
	}

	override nonisolated func acceptsPreviewPanelControl(_ panel: QLPreviewPanel!) -> Bool {
		MainActor.assumeIsolated { url != nil }
	}

	override nonisolated func beginPreviewPanelControl(_ panel: QLPreviewPanel!) {
		MainActor.assumeIsolated {
			panel.dataSource = self
			panel.reloadData()
		}
	}

	override nonisolated func endPreviewPanelControl(_ panel: QLPreviewPanel!) {
		MainActor.assumeIsolated {
			if panel.dataSource === self {
				panel.dataSource = nil
			}
		}
	}

	nonisolated func numberOfPreviewItems(in panel: QLPreviewPanel!) -> Int {
		MainActor.assumeIsolated { url == nil ? 0 : 1 }
	}

	nonisolated func previewPanel(_ panel: QLPreviewPanel!, previewItemAt index: Int) -> QLPreviewItem! {
		let staged: URL? = MainActor.assumeIsolated { index == 0 ? url : nil }
		return staged as NSURL?
	}

	@MainActor
	private func attachToResponderChain() {
		guard let window = NSApp.keyWindow ?? NSApp.mainWindow else { return }
		var tail: NSResponder = window
		while let next = tail.nextResponder {
			if next === self { return }
			tail = next
		}
		tail.nextResponder = self
	}
}
