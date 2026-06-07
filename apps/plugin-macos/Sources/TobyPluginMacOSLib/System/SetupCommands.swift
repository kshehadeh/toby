import Foundation

struct BundledShortcutEntry: Decodable {
	let file: String
	let name: String
	let description: String
}

private struct BundledShortcutsManifest: Decodable {
	let shortcuts: [BundledShortcutEntry]
}

public enum SetupCommands {
	public static func run() throws -> [[String: Any]] {
		guard SystemClient.isPlatformSupported else {
			throw HelperError.unsupported("macOS integration is only available on macOS.")
		}

		guard FileManager.default.isExecutableFile(atPath: "/usr/bin/shortcuts") else {
			throw HelperError.runtime("shortcuts CLI is not available on this Mac.")
		}

		let manifest = try loadManifest()
		let installed = try listInstalledShortcutNames()
		var actions: [[String: Any]] = []

		for entry in manifest.shortcuts {
			let actionId = shortcutActionId(for: entry.name)
			let label = "Install \(entry.name) shortcut"

			if installed.contains(entry.name) {
				actions.append([
					"id": actionId,
					"label": label,
					"ok": true,
					"skipped": true,
					"detail": "Shortcut already installed.",
				])
				continue
			}

			do {
				try openBundledShortcutImport(entry: entry)
				actions.append([
					"id": actionId,
					"label": label,
					"ok": true,
					"detail": "Opened Shortcuts import — tap Add Shortcut to finish.",
				])
			} catch {
				actions.append([
					"id": actionId,
					"label": label,
					"ok": false,
					"detail": error.localizedDescription,
				])
			}
		}

		return actions
	}

	private static func bundledResourceURL(
		name: String,
		extension ext: String
	) -> URL? {
		if let url = PluginResourceBundle.url(
			forResource: name,
			withExtension: ext,
			subdirectory: "BundledShortcuts"
		) {
			return url
		}
		return PluginResourceBundle.url(forResource: name, withExtension: ext)
	}

	private static func shortcutActionId(for name: String) -> String {
		let slug = name
			.lowercased()
			.replacingOccurrences(of: " ", with: "-")
			.filter { $0.isLetter || $0.isNumber || $0 == "-" }
		return "shortcut:\(slug)"
	}

	private static func loadManifest() throws -> BundledShortcutsManifest {
		guard let manifestURL = bundledResourceURL(
			name: "manifest",
			extension: "json"
		) else {
			throw HelperError.runtime("Bundled shortcuts manifest is missing from the plugin.")
		}

		let data = try Data(contentsOf: manifestURL)
		return try JSONDecoder().decode(BundledShortcutsManifest.self, from: data)
	}

	private static func listInstalledShortcutNames() throws -> Set<String> {
		let process = Process()
		process.executableURL = URL(fileURLWithPath: "/usr/bin/shortcuts")
		process.arguments = ["list"]
		let outPipe = Pipe()
		let errPipe = Pipe()
		process.standardOutput = outPipe
		process.standardError = errPipe
		process.standardInput = FileHandle.nullDevice
		try process.run()
		process.waitUntilExit()

		let outData = outPipe.fileHandleForReading.readDataToEndOfFile()
		let errData = errPipe.fileHandleForReading.readDataToEndOfFile()
		let stdout = String(data: outData, encoding: .utf8) ?? ""
		let stderr = String(data: errData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

		if process.terminationStatus != 0 {
			throw HelperError.runtime(
				stderr.isEmpty
					? "shortcuts list failed with exit code \(process.terminationStatus)"
					: stderr
			)
		}

		let names = stdout
			.split(whereSeparator: \.isNewline)
			.map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
			.filter { !$0.isEmpty }
		return Set(names)
	}

	private static func openBundledShortcutImport(entry: BundledShortcutEntry) throws {
		let shortcutBase = entry.file.replacingOccurrences(of: ".shortcut", with: "")
		guard let bundledURL = bundledResourceURL(
			name: shortcutBase,
			extension: "shortcut"
		) else {
			throw HelperError.runtime("Bundled shortcut file is missing: \(entry.file)")
		}

		let tempDir = FileManager.default.temporaryDirectory
			.appendingPathComponent("toby-plugin-macos-setup-\(UUID().uuidString)", isDirectory: true)
		try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
		let destination = tempDir.appendingPathComponent(entry.file)
		try FileManager.default.copyItem(at: bundledURL, to: destination)

		let process = Process()
		process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
		process.arguments = ["-g", destination.path]
		try process.run()
		process.waitUntilExit()

		if process.terminationStatus != 0 {
			throw HelperError.runtime("Failed to open shortcut import for \(entry.name).")
		}
	}
}
