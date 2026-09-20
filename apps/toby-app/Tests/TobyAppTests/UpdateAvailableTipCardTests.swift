import SwiftUI
import Testing
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("UpdateToolbarButton")
struct UpdateToolbarButtonTests {
	private func makeStore(
		currentVersion: String = "0.65.2",
		latestVersion: String = "0.66.0",
		isUpdateAvailable: Bool = true,
		isUpgrading: Bool = false,
		nativeUpdater: NativeAppUpdating = MockNativeAppUpdater()
	) -> UpdateStore {
		let suiteName = "toby.tests.update.toolbar.\(UUID().uuidString)"
		let defaults = UserDefaults(suiteName: suiteName)!
		defaults.removePersistentDomain(forName: suiteName)
		let store = UpdateStore(nativeUpdater: nativeUpdater, defaults: defaults)
		store.currentVersion = currentVersion
		store.latestVersion = latestVersion
		store.isUpdateAvailable = isUpdateAvailable
		store.isUpgrading = isUpgrading
		store.refreshUpdateTipVisibility()
		return store
	}

	@Test("renders current and latest versions with an upgrade action")
	func rendersVersionsAndUpgradeAction() throws {
		let store = makeStore()
		let view = UpdateToolbarButton(updateStore: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "toolbar-update-button")
		}
		let button = try view.inspect().find(UpdateToolbarButton.self).actualView()
		#expect(button.title == "Update available")
		#expect(button.message == "Toby is on 0.65.2. Version 0.66.0 is ready to install.")
		#expect(button.actionTitle == "Upgrade to v0.66.0")
		#expect(button.helpText == "Update to v0.66.0 is available")
		let tip = UpdateAvailableTip(
			currentVersion: "0.65.2",
			latestVersion: "0.66.0",
			presentationNonce: store.updateTipPresentationNonce
		)
		#expect(tip.id == "update-available-0.66.0-\(store.updateTipPresentationNonce)")
	}

	@Test("uses a valid download icon and swapping upgrading glyph")
	func usesValidDownloadIcon() {
		#expect(UpdateToolbarButton.iconName(isUpgrading: false) == "arrow.down.app")
		#expect(UpdateToolbarButton.iconName(isUpgrading: true) == "arrow.down.circle")
	}

	@Test("toolbar button starts a native update check")
	func toolbarButtonStartsUpdateCheck() async throws {
		let updater = MockNativeAppUpdater()
		let store = makeStore(nativeUpdater: updater)
		let view = UpdateToolbarButton(updateStore: store)
		let button = try view.inspect().find(viewWithAccessibilityIdentifier: "toolbar-update-button").button()
		try button.tap()
		for _ in 0..<20 where updater.checkCount == 0 {
			await Task.yield()
		}
		#expect(updater.checkCount == 1)
	}

	@Test("help text switches while upgrading")
	func helpTextWhileUpgrading() throws {
		let store = makeStore(isUpgrading: true)
		let view = UpdateToolbarButton(updateStore: store)
		let button = try view.inspect().find(UpdateToolbarButton.self).actualView()
		#expect(button.helpText == "Updating Toby")
		#expect(try view.inspect().find(ViewType.Button.self).isDisabled())
	}
}
