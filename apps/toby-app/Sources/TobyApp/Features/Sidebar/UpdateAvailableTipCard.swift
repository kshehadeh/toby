import SwiftUI
import TipKit

/// Toolbar download control shown when Sparkle finds a newer Toby.app. A TipKit
/// popover points at this button (not the sidebar) so dismiss can reshow after a
/// newer version or a two-day cooldown without using TipKit’s datastore as
/// source of truth.
struct UpdateToolbarButton: View {
	@Bindable var updateStore: UpdateStore

	static func iconName(isUpgrading: Bool) -> String {
		isUpgrading ? "arrow.down.circle" : "arrow.down.app"
	}

	var title: String { "Update available" }

	var message: String? {
		guard let currentVersion = updateStore.currentVersion,
			let latestVersion = updateStore.latestVersion
		else {
			return nil
		}
		return "Toby is on \(currentVersion). Version \(latestVersion) is ready to install."
	}

	var actionTitle: String? {
		guard let latestVersion = updateStore.latestVersion else { return nil }
		return "Upgrade to v\(latestVersion)"
	}

	var helpText: String {
		RootToolbars.updateHelp(
			isUpgrading: updateStore.isUpgrading,
			latestVersion: updateStore.latestVersion
		)
	}

	var body: some View {
		Button {
			Task { await updateStore.checkNativeAppForUpdates() }
		} label: {
			Image(systemName: Self.iconName(isUpgrading: updateStore.isUpgrading))
		}
		.disabled(updateStore.isUpgrading)
		.help(helpText)
		.accessibilityLabel(helpText)
		.accessibilityIdentifier("toolbar-update-button")
		.popoverTip(tip, isPresented: presentedBinding, arrowEdge: .bottom) { action in
			if action.id == "install-update" {
				Task { await updateStore.performUpgrade() }
			}
		}
		.task {
			TobyTips.configure()
		}
	}

	private var presentedBinding: Binding<Bool> {
		Binding(
			get: { updateStore.shouldShowUpdateTip },
			set: { newValue in
				if !newValue {
					updateStore.dismissUpdateTip()
				}
			}
		)
	}

	private var tip: UpdateAvailableTip {
		UpdateAvailableTip(
			currentVersion: updateStore.currentVersion ?? "",
			latestVersion: updateStore.latestVersion ?? "",
			presentationNonce: updateStore.updateTipPresentationNonce
		)
	}
}

struct UpdateAvailableTip: Tip {
	let currentVersion: String
	let latestVersion: String
	let presentationNonce: Int

	var id: String { "update-available-\(latestVersion)-\(presentationNonce)" }

	var title: Text {
		Text("Update available")
	}

	var message: Text? {
		guard !currentVersion.isEmpty, !latestVersion.isEmpty else { return nil }
		return Text("Toby is on \(currentVersion). Version \(latestVersion) is ready to install.")
	}

	var image: Image? {
		Image(systemName: UpdateToolbarButton.iconName(isUpgrading: false))
	}

	var actions: [Action] {
		guard !latestVersion.isEmpty else { return [] }
		return [Action(id: "install-update", title: "Upgrade to v\(latestVersion)")]
	}

	var options: [TipOption] {
		[Tips.IgnoresDisplayFrequency(true)]
	}
}
