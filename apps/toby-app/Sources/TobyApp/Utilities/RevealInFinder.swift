import AppKit
import Foundation

/// Helpers for revealing files or directories in macOS Finder.
enum RevealInFinder {
	/// Reveal the item at `path` in Finder, selecting it within its containing folder.
	/// If the path does not exist, opens the deepest existing ancestor folder instead.
	static func reveal(path: String) {
		let url = URL(fileURLWithPath: path)
		let fm = FileManager.default

		if fm.fileExists(atPath: path) {
			NSWorkspace.shared.activateFileViewerSelecting([url])
			return
		}

		// Fall back to the nearest existing ancestor directory.
		var current = url.deletingLastPathComponent()
		while !fm.fileExists(atPath: current.path) {
			let parent = current.deletingLastPathComponent()
			if parent.path == current.path { break }
			current = parent
		}
		NSWorkspace.shared.open(current)
	}

	/// Open the item at `path` with the default macOS app for its file type.
	@discardableResult
	static func openWithDefaultApp(path: String) -> Bool {
		NSWorkspace.shared.open(URL(fileURLWithPath: path))
	}
}
