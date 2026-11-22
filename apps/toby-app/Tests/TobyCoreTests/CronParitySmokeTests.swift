import Foundation
import Testing
@testable import TobyCore

/// Opt-in: compare `CronExpression.previous` with croner reference lines
/// (`expr|now|timezone|expected`) from `TOBY_CRON_PARITY_FILE`.
@Suite("Cron parity smoke (opt-in)")
struct CronParitySmokeTests {
	@Test(.enabled(if: ProcessInfo.processInfo.environment["TOBY_CRON_PARITY_FILE"] != nil))
	func matchesCroner() throws {
		let lines = try String(contentsOfFile: ProcessInfo.processInfo.environment["TOBY_CRON_PARITY_FILE"]!, encoding: .utf8).split(separator: "\n")
		var mismatches: [String] = []
		for line in lines {
			let parts = line.split(separator: "|").map(String.init)
			let expected = parts[3]
			let got = CronExpression(parts[0])?.previous(before: TodoRecurrence.parseISO(parts[1])!, timezone: TimeZone(identifier: parts[2])!).map(TodoRecurrence.isoString) ?? "none"
			if got != expected { mismatches.append("\(line) got \(got)") }
		}
		print("CRONPARITY \(lines.count - mismatches.count)/\(lines.count)")
		for mismatch in mismatches.prefix(10) { print("CRONPARITY MISMATCH \(mismatch)") }
		#expect(mismatches.isEmpty)
	}
}
