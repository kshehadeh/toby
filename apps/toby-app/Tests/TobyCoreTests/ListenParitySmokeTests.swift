import Foundation
import Testing
import TobyAI
@testable import TobyCore

/// Opt-in: dump recordings list + details for a copied home (read-only).
@Suite("Listen parity smoke (opt-in)")
struct ListenParitySmokeTests {
	@Test(.enabled(if: ProcessInfo.processInfo.environment["TOBY_LISTEN_PARITY_DIR"] != nil))
	func dumps() throws {
		let root = URL(fileURLWithPath: ProcessInfo.processInfo.environment["TOBY_LISTEN_PARITY_DIR"]!)
		let listen = ListenService(recordings: root.appending(path: "listen/recordings"), configURL: root.appending(path: "config.json"),
		                           personas: PersonaService(tobyDirectory: root), ai: OpenRouterClient(keyProvider: StaticAPIKey("x")), bridge: FakeBridge([:]))
		var details: [String: JSONValue] = [:]
		for recording in listen.list() { details[recording.id] = listen.detail(recording) }
		try Data(JSONValue.object(["list": listen.listJSON(), "details": .object(details)]).jsonString().utf8).write(to: root.appending(path: "n-listen.json"))
	}
}
