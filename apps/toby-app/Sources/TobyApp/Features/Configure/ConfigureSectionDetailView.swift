import SwiftUI

struct ConfigureSectionDetailView: View {
	@Bindable var store: ConfigureStore
	let section: SettingsItem

	private var fields: [SettingsItem] {
		store.detailFields(for: section)
	}

	private var mainFields: [SettingsItem] {
		fields.filter { $0.kind != .delete }
	}

	private var deleteFields: [SettingsItem] {
		fields.filter { $0.kind == .delete }
	}

	private var blockFields: [SettingsItem] {
		mainFields.filter { field in
			field.multiline == true
				|| field.kind == .hint
				|| field.kind == .image
				|| (field.readOnly == true && field.kind != .action)
		}
	}

	private var rowFields: [SettingsItem] {
		mainFields.filter { field in
			!blockFields.contains(where: { $0.id == field.id })
		}
	}

	private var isIntegrationSection: Bool {
		store.integrationLabels[section.key] != nil
	}

	/// Leaf AI provider sections (`ai.openai`, `ai.vercel`, …) with setup copy.
	private var isAIProviderSection: Bool {
		section.key.hasPrefix("ai.")
			&& section.key != "ai"
			&& (section.description?.isEmpty == false || section.docUrl?.isEmpty == false)
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 20) {
			if isIntegrationSection {
				IntegrationDetailHeader(
					store: store,
					section: section,
					status: store.integrationStatus[section.key],
					isLoading: store.integrationStatusLoading == section.key,
					isActionLoading: store.integrationActionLoading != nil,
					onAction: { action in
						Task {
							await store.runIntegrationAction(name: section.key, action: action)
						}
					},
				)
			} else {
				SettingsSectionHeader(title: section.label)
			}

			if store.sectionFieldsReloading == section.key {
				CredentialsSkeletonView()
			} else if section.key == "defaults" {
				DefaultProviderCardsView(store: store, section: section)
			} else if ConfigureTreeHelpers.isContainerSection(section)
				|| ConfigureTreeHelpers.hasNestedSections(section)
			{
				// Container sections use the hierarchy sidebar in SettingsWindowView;
				// this path is only hit if the parent is selected without a child.
				SettingsCard {
					SettingsRow(
						title: section.label,
						description: "Select an item in the sidebar to view and edit its settings.",
						showsDivider: false,
					) {
						EmptyView()
					}
				}
			} else {
				if !rowFields.isEmpty {
					SettingsCard {
						ForEach(Array(rowFields.enumerated()), id: \.element.id) { index, field in
							ConfigureFieldRowView(
								store: store,
								field: field,
								sectionLabel: section.label,
								showsDivider: index < rowFields.count - 1,
							)
						}
					}
				}

				ForEach(blockFields) { field in
					ConfigureBlockFieldView(
						store: store,
						field: field,
						sectionLabel: section.label,
					)
				}

				if isAIProviderSection {
					AIProviderSetupHelpView(section: section)
				}

				if !deleteFields.isEmpty {
					SettingsSectionHeader(title: "Danger Zone")
					SettingsCard {
						ForEach(Array(deleteFields.enumerated()), id: \.element.id) { index, field in
							SettingsRow(
								title: field.label,
								description: "This action cannot be undone.",
								showsDivider: index < deleteFields.count - 1,
							) {
								SettingsDestructiveButton(title: field.label) {
									store.requestDelete(for: field, sectionLabel: section.label)
								}
							}
						}
					}
				}
			}
		}
		.task(id: section.key) {
			if isIntegrationSection {
				await store.loadIntegrationStatus(for: section.key)
			}
		}
	}
}
