import AppKit
import Foundation
import SwiftUI
import Testing
import ViewInspector
@testable import TobyApp

@MainActor
@Suite("Home block colors")
struct DashboardColorTests {
	@Test("old layouts inherit; overrides survive persistence and card operations")
	func layoutPersistence() throws {
		let old = try JSONDecoder().decode(DashboardLayout.self, from: Data(#"{"order":[],"hidden":[]}"#.utf8))
		#expect(old.colorOverrides.isEmpty)
		let colored = old.settingColor("blue", for: .email)
		let hidden = colored.hiding(.email, from: DashboardBlockDescriptor.builtIn)
		#expect(hidden.colorOverrides == ["email": "blue"])
		#expect(hidden.settingVisibility(id: .email, visible: true).colorOverrides == colored.colorOverrides)
		#expect(hidden.withCards(order: ["calendar", "email"], hidden: []).colorOverrides == colored.colorOverrides)
		let decoded = try JSONDecoder().decode(DashboardLayout.self, from: JSONEncoder().encode(hidden))
		#expect(decoded == hidden)
		#expect(decoded.settingColor(nil, for: .email).colorOverrides.isEmpty)
	}

	@Test("override wins, neutral is explicit, clearing follows the latest default")
	func inheritance() {
		let layout = DashboardLayout.empty
		#expect(layout.resolvedColor(for: .email, defaultColor: "green") == "green")
		#expect(layout.resolvedColor(for: .email, defaultColor: nil) == nil)
		let blue = layout.settingColor("blue", for: .email)
		#expect(blue.resolvedColor(for: .email, defaultColor: "red") == "blue")
		let neutral = blue.settingColor("neutral", for: .email)
		#expect(neutral.resolvedColor(for: .email, defaultColor: "red") == "neutral")
		#expect(neutral.settingColor(nil, for: .email).resolvedColor(for: .email, defaultColor: "red") == "red")
	}

	@Test("unknown saved colors fall back without losing other layout fields")
	func invalidColors() throws {
		let data = Data(#"{"order":["email"],"hidden":[],"colorOverrides":{"email":"hotpink","calendar":"neutral"}}"#.utf8)
		let layout = try JSONDecoder().decode(DashboardLayout.self, from: data)
		#expect(layout.order == ["email"])
		#expect(layout.colorOverrides == ["calendar": "neutral"])
	}

	@Test("flow dashboard defaults round-trip for cards and runners")
	func flowRoundTrip() throws {
		for variant in ["informational", "runner"] {
			for color in ["blue", "neutral"] {
				let data = Data("""
				{"id":"flow.test","name":"Test","color":"teal","nodes":[],
				 "destinations":[{"type":"dashboard","variant":"\(variant)","color":"\(color)"}]}
				""".utf8)
				let document = try JSONDecoder().decode(FlowDocumentPayload.self, from: data)
				let draft = FlowEditorDraft.from(document: document)
				#expect(draft.color == "teal")
				#expect(draft.destinations.first?.dashboardColor == color)
				let destinations = draft.jsonBody()["destinations"] as? [[String: Any]]
				#expect(destinations?.first?["color"] as? String == color)
			}
		}
		#expect(FlowEditorDestination.dashboard().jsonBody()["color"] == nil)
		var cleared = FlowEditorDestination.dashboard()
		cleared.dashboardColor = "blue"
		cleared.dashboardColor = ""
		#expect(cleared.jsonBody()["color"] == nil)
	}

	@Test("palette controls expose inheritance and neutral choices")
	func pickerChoices() throws {
		let picker = DashboardColorPicker(selection: .constant(""))
		#expect(throws: Never.self) { try picker.inspect().find(text: "Use default") }
		#expect(throws: Never.self) { try picker.inspect().find(text: "Neutral") }
		#expect(throws: Never.self) { try picker.inspect().find(text: "Blue") }
		let overlay = DashboardEditOverlay(title: "Mail", blockID: .email, colorSelection: .constant("blue"))
		#expect(throws: Never.self) { try overlay.inspect().find(viewWithAccessibilityIdentifier: "dashboard-color-email") }
	}

	@Test("Home color menu changes the binding and can return to inheritance")
	func menuSelection() throws {
		var selection = ""
		let binding = Binding(get: { selection }, set: { selection = $0 })
		let overlay = DashboardEditOverlay(title: "Mail", blockID: .email, colorSelection: binding)
		try overlay.inspect().find(button: "Blue").tap()
		#expect(selection == "blue")
		try overlay.inspect().find(button: "Neutral").tap()
		#expect(selection == "neutral")
		try overlay.inspect().find(button: "Use default").tap()
		#expect(selection.isEmpty)
	}

	@Test("tinted backgrounds remain opaque and adapt to both appearances")
	func dynamicBackgrounds() throws {
		for appearanceName in [NSAppearance.Name.aqua, .darkAqua] {
			let appearance = try #require(NSAppearance(named: appearanceName))
			for option in FlowColorOption.all {
				var tinted: NSColor?
				var base: NSColor?
				appearance.performAsCurrentDrawingAppearance {
					tinted = DashboardBlockColor.backgroundNSColor(option.id).usingColorSpace(.sRGB)
					base = NSColor.tobyContentBackground.usingColorSpace(.sRGB)
				}
				let resolved = try #require(tinted)
				let neutral = try #require(base)
				#expect(resolved.alphaComponent == 1)
				#expect(resolved != neutral)
				let maximumDifference = max(abs(resolved.redComponent - neutral.redComponent), abs(resolved.greenComponent - neutral.greenComponent), abs(resolved.blueComponent - neutral.blueComponent))
				#expect(maximumDifference < 0.15)
			}
		}
		#expect(DashboardBlockColor.border("blue") == AccentPreset.blue.color)
	}
}
