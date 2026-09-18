import AppKit
import SwiftUI

/// Plugin path and authentication methods as grouped Form sections.
struct IntegrationSettingsMetaSections: View {
	let status: IntegrationStatus?

	@ViewBuilder
	var body: some View {
		if let status {
			if let pluginPath = status.pluginPath, !pluginPath.isEmpty {
				Section("Location") {
					RevealPathButton(path: pluginPath, label: "Plugin folder")
				}
			}
			if let authMethods = status.authMethods, !authMethods.isEmpty {
				Section("Authentication") {
					ForEach(authMethods, id: \.id) { method in
						LabeledContent(method.label) {
							if method.isDefault == true {
								Image(systemName: "checkmark.circle.fill")
									.foregroundStyle(AppTheme.accent)
									.accessibilityLabel("Default")
							}
						}
					}
				}
			}
		}
	}
}

/// Tools list and setup-guide steps as grouped Form sections.
struct IntegrationSettingsToolsAndGuideSections: View {
	@Bindable var store: ConfigureStore
	let section: SettingsItem
	@State private var isToolsExpanded = false
	@State private var isSetupGuideExpanded = false

	private var status: IntegrationStatus? {
		store.integrationStatus[section.key]
	}

	private var guide: IntegrationSetupGuide? {
		store.setupGuide
	}

	private var isGuideLoading: Bool {
		store.setupGuideLoading == section.key
	}

	@ViewBuilder
	var body: some View {
		if let tools = status?.tools, !tools.isEmpty {
			Section {
				DisclosureGroup(isExpanded: $isToolsExpanded) {
					ForEach(tools) { tool in
						VStack(alignment: .leading, spacing: 4) {
							Text(tool.displayName)
							Text(tool.description)
								.font(.caption)
								.foregroundStyle(.secondary)
								.fixedSize(horizontal: false, vertical: true)
						}
						.formLeadingAligned()
						.padding(.vertical, 4)
					}
				} label: {
					Text("Tools (\(tools.count))")
						.formLeadingAligned()
				}
				.formLeadingAligned()
				.accessibilityLabel(isToolsExpanded ? "Collapse tools" : "Expand tools")
			}
		}

		if isGuideLoading {
			Section("Setup Guide") {
				HStack(spacing: 8) {
					ProgressView().controlSize(.small)
					Text("Loading setup guide…")
						.foregroundStyle(.secondary)
				}
				.formLeadingAligned()
			}
		} else if let guide, guide.ok, let steps = guide.steps, !steps.isEmpty {
			Section {
				DisclosureGroup(isExpanded: $isSetupGuideExpanded) {
					ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
						setupStep(index: index, step: step)
					}
				} label: {
					Text("Setup Guide")
						.formLeadingAligned()
				}
				.formLeadingAligned()
				.accessibilityLabel(
					isSetupGuideExpanded ? "Collapse setup guide" : "Expand setup guide"
				)
			}
		} else if let guide, !guide.ok, let error = guide.error {
			Section("Setup Guide") {
				InlineStatusMessage(message: error, tone: .error, font: .caption)
			}
		}
	}

	private func setupStep(index: Int, step: IntegrationSetupGuideStep) -> some View {
		VStack(alignment: .leading, spacing: 8) {
			Text("\(index + 1). \(step.title)")
				.font(.subheadline.weight(.semibold))
			if let description = step.description, !description.isEmpty {
				Text(description)
					.font(.caption)
					.foregroundStyle(.secondary)
					.fixedSize(horizontal: false, vertical: true)
			}
			if let links = step.links, !links.isEmpty {
				ForEach(Array(links.enumerated()), id: \.offset) { _, link in
					if let url = URL(string: link.url) {
						Link(destination: url) {
							Label(link.label, systemImage: "link")
						}
						.formLeadingAligned()
					}
				}
			}
			if let artifacts = step.artifacts, !artifacts.isEmpty {
				ForEach(artifacts) { artifact in
					VStack(alignment: .leading, spacing: 4) {
						Text(artifact.label)
							.font(.caption.weight(.medium))
							.foregroundStyle(.secondary)
						HStack {
							Text(artifact.value)
								.font(.caption.monospaced())
								.textSelection(.enabled)
							Spacer()
							Button("Copy") {
								NSPasteboard.general.clearContents()
								NSPasteboard.general.setString(artifact.value, forType: .string)
							}
							.controlSize(.small)
						}
						if let hint = artifact.hint, !hint.isEmpty {
							Text(hint)
								.font(.caption)
								.foregroundStyle(.tertiary)
						}
					}
					.formLeadingAligned()
				}
			}
		}
		.formLeadingAligned()
		.padding(.vertical, 4)
	}
}

private extension View {
	/// Grouped `Form` centers intrinsic-width rows; fill the row and pin leading.
	func formLeadingAligned() -> some View {
		frame(maxWidth: .infinity, alignment: .leading)
			.multilineTextAlignment(.leading)
	}
}
