import SwiftUI
import Testing
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("UpdateAvailableTipCard")
struct UpdateAvailableTipCardTests {
	@Test("renders current and latest versions with an upgrade action")
	func rendersVersionsAndUpgradeAction() throws {
		let suiteName = "toby.tests.update.tipcard.\(UUID().uuidString)"
		let defaults = UserDefaults(suiteName: suiteName)!
		defaults.removePersistentDomain(forName: suiteName)
		let store = UpdateStore(defaults: defaults)
		store.currentVersion = "0.65.2"
		store.latestVersion = "0.66.0"
		store.isUpdateAvailable = true
		store.refreshUpdateTipVisibility()

		let view = UpdateAvailableTipCard(updateStore: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "sidebar-update-available-tip")
		}
		let card = try view.inspect().find(UpdateAvailableTipCard.self).actualView()
		#expect(card.title == "Update available")
		#expect(card.message == "Toby is on 0.65.2. Version 0.66.0 is ready to install.")
		#expect(card.actionTitle == "Upgrade to v0.66.0")
	}
}
