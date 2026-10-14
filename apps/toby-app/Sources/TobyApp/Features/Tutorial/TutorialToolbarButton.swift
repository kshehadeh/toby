import SwiftUI

struct TutorialToolbarButton: View {
	let section: TutorialSection
	let onStart: () -> Void

	var body: some View {
		Button(action: onStart) {
			Image(systemName: "questionmark.circle")
		}
		.help("Start or restart the \(section.title) tutorial")
		.accessibilityLabel("\(section.title) tutorial")
		.accessibilityIdentifier("toolbar-tutorial-button")
		.tutorialTip(
			.home, .chats, .projects, .library, .recordings, .flows, .skills,
			available: TutorialStore.shared.activeSection == section
				&& TutorialStore.shared.currentStep == section.steps.first
		)
	}
}
