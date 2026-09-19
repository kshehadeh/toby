import SwiftUI
import TipKit

/// Inline TipKit card for a pending native-app update. Presentation is bound to
/// `UpdateStore.shouldShowUpdateTip` so dismiss can reshow after a newer version
/// or a two-day cooldown without using TipKit’s datastore as source of truth.
struct UpdateAvailableTipCard: View {
	@Bindable var updateStore: UpdateStore

	var accessibilityId: String = "sidebar-update-available-tip"

	var body: some View {
		TipView(tip, isPresented: presentedBinding, arrowEdge: nil) { action in
			if action.id == "install-update" {
				Task { await updateStore.performUpgrade() }
			}
		}
		.frame(maxWidth: .infinity, alignment: .leading)
		.padding(.horizontal, 8)
		.padding(.vertical, 8)
		.accessibilityIdentifier(accessibilityId)
		.task {
			TobyTips.configure()
		}
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
		Image(systemName: "arrow.down.circle.badge.clock")
	}

	var actions: [Action] {
		guard !latestVersion.isEmpty else { return [] }
		return [Action(id: "install-update", title: "Upgrade to v\(latestVersion)")]
	}

	var options: [TipOption] {
		[Tips.IgnoresDisplayFrequency(true)]
	}
}
