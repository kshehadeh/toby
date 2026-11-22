import Foundation
import Testing
@testable import TobyCore

/// Opt-in: write a Swift-encrypted batch for the daemon to decrypt (TOBY_BATCH_OUT).
@Suite("Swift batch export (opt-in)")
struct SwiftBatchExportTests {
	@Test(.enabled(if: ProcessInfo.processInfo.environment["TOBY_BATCH_OUT"] != nil))
	func exportsBatch() throws {
		let operations = try TodoBatchCodec.decrypt(TodoSyncTests.fixture, password: "fixture-password")
		var op = operations[0]
		op.id = "op-swift-1"
		op.replica = "replica-swift"
		let batch = try TodoBatchCodec.encrypt([op], password: "swift-password")
		try batch.write(toFile: ProcessInfo.processInfo.environment["TOBY_BATCH_OUT"]!, atomically: true, encoding: .utf8)
	}
}
