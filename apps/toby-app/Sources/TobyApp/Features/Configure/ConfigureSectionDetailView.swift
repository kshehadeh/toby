import SwiftUI

struct ConfigureSectionDetailView: View {
	@Bindable var store: ConfigureStore
	let section: SettingsItem
	/// Client-local prefs for app-only Home controls (card visibility, onboarding).
	@Bindable var appearancePreferences: AppearancePreferences = .shared
	/// Called after guided provider setup succeeds so the host can refresh status.
	var onGuidedSetupCompleted: (() -> Void)? = nil

	@State private var guidedSetupProviderId: String?

	private var fields: [SettingsItem] {
		store.detailFields(for: section)
	}

	private var isDashboardSection: Bool {
		section.key == "dashboard"
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

	/// Extracts the provider ID from a section key like `ai.openai` -> `openai`.
	private var aiProviderId: String? {
		guard isAIProviderSection else { return nil }
		return String(section.key.dropFirst("ai.".count))
	}

	/// Providers with a server-side setup adapter (must match core registry).
	private var supportsGuidedSetup: Bool {
		guard let aiProviderId else { return false }
		return ["vercel", "openrouter"].contains(aiProviderId)
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
				SettingsSectionHeader(title: section.displayLabel)
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
						title: section.displayLabel,
						description: "Select an item in the sidebar to view and edit its settings.",
						showsDivider: false,
					) {
						EmptyView()
					}
				}
			} else {
				Group {
					if !rowFields.isEmpty {
						SettingsCard {
							ForEach(Array(rowFields.enumerated()), id: \.element.id) { index, field in
								ConfigureFieldRowView(
									store: store,
									field: field,
									sectionLabel: section.displayLabel,
									showsDivider: index < rowFields.count - 1,
								)
							}
						}
					}

					ForEach(blockFields) { field in
						ConfigureBlockFieldView(
							store: store,
							field: field,
							sectionLabel: section.displayLabel,
						)
					}
				}
				.id(
					"\(section.key)-auth-\(store.resolvedAuthMethod(for: section))-in-\(store.isInboundEnabled(for: section))"
				)

				if isDashboardSection {
					SettingsCard {
						ForEach(DashboardBlock.allCases) { block in
							SettingsRow(
								title: block.settingsTitle,
								description: block.settingsDescription,
								showsDivider: true
							) {
								SettingsToggle(
									isOn: appearancePreferences.dashboardBlockVisibilityBinding(block)
								)
								.accessibilityIdentifier(block.accessibilityIdentifier)
							}
						}
						SettingsRow(
							title: "Hide onboarding checklist",
							description:
								"Hide the setup checklist on Home even if steps are incomplete. Stored only on this Mac.",
							showsDivider: true
						) {
							SettingsToggle(isOn: appearancePreferences.hideOnboardingBinding)
								.accessibilityIdentifier("dashboard-hide-onboarding-toggle")
						}
						SettingsRow(
							title: "Reset Home layout",
							description:
								"Restore default card order and show all cards. Stored only on this Mac.",
							showsDivider: false
						) {
							SettingsActionButton(title: "Reset") {
								appearancePreferences.resetDashboardLayout()
							}
							.accessibilityIdentifier("dashboard-reset-layout-button")
						}
					}
				}

				if isAIProviderSection {
					if supportsGuidedSetup, let providerId = aiProviderId {
						SettingsCard {
							SettingsRow(
								title: "Guided setup",
								description:
									"Step-by-step account, API key creation, and one-click validation.",
								showsDivider: false
							) {
								SettingsActionButton(title: "Start setup") {
									guidedSetupProviderId = providerId
								}
								.accessibilityIdentifier("ai-guided-setup-button-\(providerId)")
							}
						}
					}
					if let providerId = aiProviderId {
						AIProviderUsageView(providerId: providerId)
					}
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
									store.requestDelete(for: field, sectionLabel: section.displayLabel)
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
		.sheet(item: Binding(
			get: { guidedSetupProviderId.map { GuidedSetupSheetItem(id: $0) } },
			set: { guidedSetupProviderId = $0?.id }
		)) { item in
			VercelAIGatewaySetupWizardView(
				providerId: item.id,
				onCompleted: {
					onGuidedSetupCompleted?()
					Task { await store.loadSectionDetail(section.key) }
				},
				onDismiss: { guidedSetupProviderId = nil }
			)
		}
	}

	private struct GuidedSetupSheetItem: Identifiable {
		let id: String
	}
}
