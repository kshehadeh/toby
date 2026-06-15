import ApplicationServices
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
		var previouslyOpened = loadPreviouslyOpenedShortcuts()
		var actions: [[String: Any]] = []

		for entry in manifest.shortcuts {
			let actionId = shortcutActionId(for: entry.name)
			let label = "Install \(entry.name) shortcut"

			if isShortcutInstalled(entry.name, in: installed) {
				actions.append([
					"id": actionId,
					"label": label,
					"ok": true,
					"skipped": true,
					"detail": "Shortcut already installed.",
				])
				continue
			}

			if previouslyOpened.contains(entry.name) {
				actions.append([
					"id": actionId,
					"label": label,
					"ok": true,
					"skipped": true,
					"detail": "Shortcut import was already opened in a previous setup run. If you still need to add it, open Shortcuts.app manually.",
				])
				continue
			}

			do {
				try openBundledShortcutImport(entry: entry)
				previouslyOpened.insert(entry.name)
				savePreviouslyOpenedShortcuts(previouslyOpened)
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

		actions.append(accessibilityPermissionAction())

		return actions
	}

	public static func isAccessibilityTrusted() -> Bool {
		AXIsProcessTrusted()
	}

	private static func accessibilityPermissionAction() -> [String: Any] {
		let actionId = "accessibility-permission"
		let label = "Grant Accessibility permission for window minimize"
		if AXIsProcessTrusted() {
			PluginLog.info("accessibility_already_trusted", data: PluginLog.processFingerprint())
			return [
				"id": actionId,
				"label": label,
				"ok": true,
				"skipped": true,
				"detail": "Accessibility permission is already granted for the plugin.",
			]
		}
		PluginLog.info("accessibility_prompt_requested", data: PluginLog.processFingerprint())
		let options: CFDictionary = ["AXTrustedCheckOptionPrompt": kCFBooleanTrue!] as CFDictionary
		_ = AXIsProcessTrustedWithOptions(options)
		let fp = PluginLog.processFingerprint()
		let exe = fp["executable"] as? String ?? "(unknown)"
		let parent = fp["parentExecutable"] as? String ?? ""
		var detail = "Requested Accessibility prompt. macOS sees the calling executable as: \(exe)."
		if !parent.isEmpty {
			detail += " Parent process: \(parent)."
		}
		detail += " Toggle the matching entry on in System Settings → Privacy & Security → Accessibility, then re-run setup. Plugin log: ~/.toby/plugin-macos.log."
		return [
			"id": actionId,
			"label": label,
			"ok": true,
			"detail": detail,
		]
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

	private static func isShortcutInstalled(_ name: String, in installed: Set<String>) -> Bool {
		let target = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
		return installed.contains(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == target })
	}

	private static var stateFileURL: URL {
		tobyDir().appendingPathComponent("plugin-macos-setup-state.json")
	}

	private static func tobyDir() -> URL {
		if let override = ProcessInfo.processInfo.environment["TOBY_DIR"], !override.isEmpty {
			return URL(fileURLWithPath: (override as NSString).expandingTildeInPath, isDirectory: true)
		}
		let home = FileManager.default.homeDirectoryForCurrentUser
		return home.appendingPathComponent(".toby", isDirectory: true)
	}

	private static func loadPreviouslyOpenedShortcuts() -> Set<String> {
		let url = stateFileURL
		guard let data = try? Data(contentsOf: url),
			let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
			let names = json["openedShortcuts"] as? [String]
		else { return [] }
		return Set(names)
	}

	private static func savePreviouslyOpenedShortcuts(_ names: Set<String>) {
		let url = stateFileURL
		let json: [String: Any] = ["openedShortcuts": Array(names)]
		guard let data = try? JSONSerialization.data(withJSONObject: json, options: [.sortedKeys]) else { return }
		try? data.write(to: url, options: .atomic)
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

		let rawLines = stdout
			.split(whereSeparator: \.isNewline)
			.map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
			.filter { !$0.isEmpty }

		PluginLog.debug("shortcuts_list_raw", data: [
			"exitCode": process.terminationStatus,
			"lineCount": rawLines.count,
			"names": rawLines,
			"stderr": stderr,
		])

		if process.terminationStatus != 0 {
			throw HelperError.runtime(
				stderr.isEmpty
					? "shortcuts list failed with exit code \(process.terminationStatus)"
					: stderr
			)
		}

		return Set(rawLines)
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
