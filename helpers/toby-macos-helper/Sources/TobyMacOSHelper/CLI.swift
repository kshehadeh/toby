import Foundation

// MARK: - Output helpers

struct JSONOutput {
	static let helperVersion = "0.1.0"

	static func success(_ data: [String: Any]) {
		emit(["ok": true, "helperVersion": helperVersion, "data": data])
	}

	static func error(code: String, _ message: String) {
		emit(["ok": false, "helperVersion": helperVersion, "error": message, "code": code])
	}

	static func emit(_ fields: [String: Any]) {
		guard JSONSerialization.isValidJSONObject(fields),
			let data = try? JSONSerialization.data(withJSONObject: fields),
			let line = String(data: data, encoding: .utf8)
		else { return }
		print(line)
		fflush(stdout)
	}
}

// MARK: - Argument parsing

struct ArgParser {
	let args: [String]
	var index: Int = 0

	var isExhausted: Bool { index >= args.count }

	mutating func next() -> String? {
		guard index < args.count else { return nil }
		let val = args[index]
		index += 1
		return val
	}

	mutating func nextRequired(_ label: String) throws -> String {
		guard let val = next() else {
			throw HelperError.usage("\(label) requires a value")
		}
		return val
	}

	mutating func parseFlag(_ name: String) -> Bool {
		if index < args.count && args[index] == name {
			index += 1
			return true
		}
		return false
	}

	mutating func parseValue(_ name: String) -> String? {
		if index < args.count && args[index] == name {
			index += 1
			return next()
		}
		return nil
	}
}

// MARK: - Error types

enum HelperError: Error, CustomStringConvertible {
	case usage(String)
	case permission(String)
	case runtime(String)
	case unsupported(String)

	var description: String {
		switch self {
		case let .usage(m), let .permission(m), let .runtime(m), let .unsupported(m):
			return m
		}
	}
}

// MARK: - Command dispatch

@main
enum TobyMacOSHelper {
	static func main() async {
		let rawArgs = Array(CommandLine.arguments.dropFirst())
		guard rawArgs.count >= 2 else {
			if rawArgs == ["--version"] {
				print(JSONOutput.helperVersion)
				return
			}
			JSONOutput.error(code: "usage", "Usage: toby-macos-helper <domain> <action> [flags]\nDomains: wifi, audio, bluetooth, battery, display, lowpower, shortcuts, clipboard, system")
			exit(2)
		}

		let domain = rawArgs[0]
		let action = rawArgs[1]
		var parser = ArgParser(args: Array(rawArgs.dropFirst(2)))

		do {
			switch (domain, action) {
			// Wi-Fi
			case ("wifi", "status"):
				try WiFiCommands.status()
			case ("wifi", "scan"):
				try WiFiCommands.scan()
			case ("wifi", "power"):
				try WiFiCommands.power(&parser)
			// Audio
			case ("audio", "list"):
				try AudioCommands.list()
			case ("audio", "switch-output"):
				try AudioCommands.switchOutput(&parser)
			case ("audio", "volume"):
				try AudioCommands.volume()
			case ("audio", "set-volume"):
				try AudioCommands.setVolume(&parser)
			case ("audio", "set-mute"):
				try AudioCommands.setMute(&parser)
			// Bluetooth
			case ("bluetooth", "status"):
				try BluetoothCommands.status()
			case ("bluetooth", "power"):
				try BluetoothCommands.power(&parser)
			// Battery
			case ("battery", "status"):
				try BatteryCommands.status()
			// Display
			case ("display", "brightness"):
				try DisplayCommands.brightness()
			case ("display", "set-brightness"):
				try DisplayCommands.setBrightness(&parser)
			// Low power mode
			case ("lowpower", "status"):
				try LowPowerCommands.status()
			case ("lowpower", "set"):
				try LowPowerCommands.set(&parser)
			// Shortcuts
			case ("shortcuts", "run"):
				try ShortcutsCommands.run(&parser)
			// Clipboard
			case ("clipboard", "read"):
				try ClipboardCommands.read()
			case ("clipboard", "write"):
				try ClipboardCommands.write(&parser)
			// System info
			case ("system", "info"):
				try SystemInfoCommands.info()
			default:
				throw HelperError.usage("Unknown domain/action: \(domain) \(action)")
			}
		} catch let error as HelperError {
			let code: String
			switch error {
			case .usage: code = "usage"
			case .permission: code = "permission_denied"
			case .runtime: code = "runtime_error"
			case .unsupported: code = "unsupported"
			}
			JSONOutput.error(code: code, error.description)
			exit(1)
		} catch {
			JSONOutput.error(code: "runtime_error", error.localizedDescription)
			exit(1)
		}
	}
}
