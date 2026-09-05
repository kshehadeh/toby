import Foundation

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
	@MainActor
	static func previewOrOpen(path: String, setPreviewURL: (URL?) -> Void) {
		if let url = previewURL(for: path) {
			setPreviewURL(url)
		} else {
			RevealInFinder.openWithDefaultApp(path: path)
		}
	}
}
