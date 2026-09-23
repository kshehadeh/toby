import SwiftUI

/// Authentication methods as a grouped Form section.
/// The plugin folder is shown in the detail header, which reveals it in Finder.
struct IntegrationSettingsMetaSections: View {
	let status: IntegrationStatus?

	@ViewBuilder
	var body: some View {
		if let status {
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

/// Tools list as a grouped Form section.
/// Setup steps open from the header Setup Guide button, not an inline disclosure.
struct IntegrationSettingsToolsAndGuideSections: View {
	@Bindable var store: ConfigureStore
	let section: SettingsItem
	@State private var isToolsExpanded = false

	private var status: IntegrationStatus? {
		store.integrationStatus[section.key]
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
	}
}

private extension View {
	/// Grouped `Form` centers intrinsic-width rows; fill the row and pin leading.
	func formLeadingAligned() -> some View {
		frame(maxWidth: .infinity, alignment: .leading)
			.multilineTextAlignment(.leading)
	}
}
