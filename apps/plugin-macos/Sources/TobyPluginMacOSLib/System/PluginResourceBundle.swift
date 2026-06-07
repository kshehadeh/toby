import Foundation

enum PluginResourceBundle {
	static func url(
		forResource name: String,
		withExtension ext: String?,
		subdirectory: String? = nil
	) -> URL? {
		if let url = Bundle.module.url(
			forResource: name,
			withExtension: ext,
			subdirectory: subdirectory
		) {
			return url
		}

		let executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
		let pluginDir = executableURL.deletingLastPathComponent()
		for case let bundleURL as URL in BundleCandidate.urls(near: pluginDir) {
			if let url = Bundle(url: bundleURL)?.url(
				forResource: name,
				withExtension: ext,
				subdirectory: subdirectory
			) {
				return url
			}
		}

		return nil
	}
}

private enum BundleCandidate {
	static func urls(near pluginDir: URL) -> [URL] {
		let fm = FileManager.default
		guard let entries = try? fm.contentsOfDirectory(
			at: pluginDir,
			includingPropertiesForKeys: nil
		) else {
			return []
		}

		return entries.filter { $0.pathExtension == "bundle" }
	}
}
