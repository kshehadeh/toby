import Foundation

enum ShortcutsCommands {
	static func run(name: String) throws -> [String: Any] {
		let process = Process()
		process.executableURL = URL(fileURLWithPath: "/usr/bin/shortcuts")
		process.arguments = ["run", name]
		let outPipe = Pipe()
		let errPipe = Pipe()
		process.standardOutput = outPipe
		process.standardError = errPipe
		process.standardInput = FileHandle.nullDevice
		try process.run()
		process.waitUntilExit()

		let outData = outPipe.fileHandleForReading.readDataToEndOfFile()
		let errData = errPipe.fileHandleForReading.readDataToEndOfFile()
		let stdout = String(data: outData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		let stderr = String(data: errData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

		if process.terminationStatus != 0 {
			throw HelperError.runtime("Shortcut \"\(name)\" failed: \(stderr.isEmpty ? "exit code \(process.terminationStatus)" : stderr)")
		}

		return [
			"shortcutName": name,
			"output": stdout,
		]
	}
}
