import Foundation
import IOKit

enum SystemInfoCommands {
	static func info() throws {
		var result: [String: Any] = [:]

		let swVers = runProcess("/usr/bin/sw_vers", [])
		result["osVersion"] = swVers

		var size = 0
		sysctlbyname("hw.model", nil, &size, nil, 0)
		var model = [CChar](repeating: 0, count: size)
		sysctlbyname("hw.model", &model, &size, nil, 0)
		result["hardwareModel"] = stringFromCChars(model)

		var nameSize = 0
		sysctlbyname("hw.machine", nil, &nameSize, nil, 0)
		var machine = [CChar](repeating: 0, count: nameSize)
		sysctlbyname("hw.machine", &machine, &nameSize, nil, 0)
		let machineStr = stringFromCChars(machine)
		result["machine"] = machineStr

		result["hostname"] = Host.current().localizedName ?? ""
		result["hostName"] = ProcessInfo.processInfo.hostName

		let uptime = ProcessInfo.processInfo.systemUptime
		result["uptimeSeconds"] = Int(uptime)

		result["processorCount"] = ProcessInfo.processInfo.processorCount
		result["physicalMemoryMB"] = Int(ProcessInfo.processInfo.physicalMemory / 1_048_576)

		let osVersion = ProcessInfo.processInfo.operatingSystemVersion
		result["osVersionMajor"] = osVersion.majorVersion
		result["osVersionMinor"] = osVersion.minorVersion
		result["osVersionPatch"] = osVersion.patchVersion
		result["osVersionString"] = "\(osVersion.majorVersion).\(osVersion.minorVersion).\(osVersion.patchVersion)"

		result["isAppleSilicon"] = machineStr.hasPrefix("arm")

		JSONOutput.success(result)
	}

	private static func stringFromCChars(_ chars: [CChar]) -> String {
		let bytes = chars.prefix(while: { $0 != 0 }).map { UInt8(truncatingIfNeeded: $0) }
		return String(decoding: bytes, as: UTF8.self)
	}

	private static func runProcess(_ path: String, _ args: [String]) -> String {
		let process = Process()
		process.executableURL = URL(fileURLWithPath: path)
		process.arguments = args
		let pipe = Pipe()
		process.standardOutput = pipe
		process.standardError = FileHandle.nullDevice
		try? process.run()
		process.waitUntilExit()
		let data = pipe.fileHandleForReading.readDataToEndOfFile()
		return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
	}
}
