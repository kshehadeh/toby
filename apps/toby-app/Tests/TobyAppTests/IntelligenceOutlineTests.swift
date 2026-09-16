import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("IntelligenceOutline")
struct IntelligenceOutlineTests {
	@Test("shows default identifier while active")
	func showsDefaultIdentifierWhileActive() throws {
		let view = Text("Body").intelligenceOutline(isActive: true)
		#expect(throws: Never.self) {
			_ = try view.inspect().find(viewWithAccessibilityIdentifier: "intelligence-outline")
		}
	}

	@Test("hides identifier while idle")
	func hidesIdentifierWhileIdle() throws {
		let view = Text("Body").intelligenceOutline(isActive: false)
		#expect(throws: (any Error).self) {
			_ = try view.inspect().find(viewWithAccessibilityIdentifier: "intelligence-outline")
		}
	}

	@Test("uses a custom identifier while active")
	func usesCustomIdentifierWhileActive() throws {
		let view = Text("Body").intelligenceOutline(
			isActive: true,
			accessibilityIdentifier: "custom-intelligence-outline"
		)
		#expect(throws: Never.self) {
			_ = try view.inspect().find(viewWithAccessibilityIdentifier: "custom-intelligence-outline")
		}
		#expect(throws: (any Error).self) {
			_ = try view.inspect().find(viewWithAccessibilityIdentifier: "intelligence-outline")
		}
	}

	@Test("follows a capsule shape")
	func followsCapsuleShape() throws {
		let view = Text("Body").intelligenceOutline(isActive: true, in: Capsule())
		#expect(throws: Never.self) {
			_ = try view.inspect().find(viewWithAccessibilityIdentifier: "intelligence-outline")
		}
	}
}
