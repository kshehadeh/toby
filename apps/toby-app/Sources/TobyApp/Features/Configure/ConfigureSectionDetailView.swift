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
			|| store.isIntegrationPluginKey(section.key)
			|| store.integrationSections.contains { $0.key == section.key }
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

	private var isAIProviderConnected: Bool {
		store.isAIProviderConfigured(sectionKey: section.key) == true
	}

	var body: some View {
		Form {
			if isIntegrationSection {
				Section {
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
						onRemove: section.isMcpConnection
							? {
								store.pendingDelete = ConfigureStore.PendingDelete(
									action: "remove-connection",
									body: ["id": section.key],
									title: "Remove MCP server?",
									message: "This disconnects \(section.label) and deletes its saved configuration.",
									confirmLabel: "Remove"
								)
							}
							: nil,
					)
				}
				IntegrationSettingsMetaSections(status: store.integrationStatus[section.key])
			}

			if isAIProviderSection {
				Section {
					AIProviderDetailHeader(
						section: section,
						isConnected: store.isAIProviderConfigured(sectionKey: section.key),
						isLoading: store.aiProvidersStatusLoading
							&& store.aiProviderConfigured.isEmpty
					)
				}
			}

			if store.sectionFieldsReloading == section.key {
				Section {
					CredentialsSkeletonView()
				}
			} else if section.key == "defaults" {
				Section {
					DefaultProviderCardsView(store: store, section: section)
				}
			} else if ConfigureTreeHelpers.isContainerSection(section)
				|| ConfigureTreeHelpers.hasNestedSections(section)
			{
				Section {
					Text("Select an item in the sidebar to view and edit its settings.")
						.foregroundStyle(.secondary)
				}
			} else {
				if !rowFields.isEmpty {
					Section {
						ForEach(rowFields) { field in
							ConfigureFieldRowView(
								store: store,
								field: field,
								sectionLabel: section.displayLabel,
								showsDivider: false,
								usesFormChrome: true,
							)
						}
					}
					.id(
						"\(section.key)-auth-\(store.resolvedAuthMethod(for: section))-in-\(store.isInboundEnabled(for: section))"
					)
				}

				ForEach(blockFields) { field in
					ConfigureBlockFieldView(
						store: store,
						field: field,
						sectionLabel: section.displayLabel,
						usesFormChrome: true,
					)
				}

				if isDashboardSection {
					Section(section.displayLabel) {
						ForEach(DashboardBlock.allCases) { block in
							Toggle(isOn: appearancePreferences.dashboardBlockVisibilityBinding(block)) {
								VStack(alignment: .leading, spacing: 2) {
									Text(block.settingsTitle)
									Text(block.settingsDescription)
										.font(.caption)
										.foregroundStyle(.secondary)
								}
							}
							.toggleStyle(.switch)
							.accessibilityIdentifier(block.accessibilityIdentifier)
						}
						Toggle(isOn: appearancePreferences.hideOnboardingBinding) {
							VStack(alignment: .leading, spacing: 2) {
								Text("Hide onboarding checklist")
								Text(
									"Hide the setup checklist on Home even if steps are incomplete. Stored only on this Mac."
								)
								.font(.caption)
								.foregroundStyle(.secondary)
							}
						}
						.toggleStyle(.switch)
						.accessibilityIdentifier("dashboard-hide-onboarding-toggle")
						Toggle(isOn: appearancePreferences.showDashboardActionTitlesBinding) {
							VStack(alignment: .leading, spacing: 2) {
								Text("Show action titles")
								Text(
									"Show the flow name under each Actions icon on Home. Hover still shows the title and description. Stored only on this Mac."
								)
								.font(.caption)
								.foregroundStyle(.secondary)
							}
						}
						.toggleStyle(.switch)
						.accessibilityIdentifier("dashboard-show-action-titles-toggle")
						LabeledContent("Reset Home layout") {
							Button("Reset") {
								appearancePreferences.resetDashboardLayout()
							}
							.accessibilityIdentifier("dashboard-reset-layout-button")
						}
						Text("Restore default card order and show all cards. Stored only on this Mac.")
							.font(.caption)
							.foregroundStyle(.secondary)
					}
				}

				if isAIProviderSection {
					if !isAIProviderConnected, supportsGuidedSetup, let providerId = aiProviderId {
						Section("Guided setup") {
							LabeledContent("Setup") {
								Button("Start setup") {
									guidedSetupProviderId = providerId
								}
								.accessibilityIdentifier("ai-guided-setup-button-\(providerId)")
							}
							Text("Step-by-step account, API key creation, and one-click validation.")
								.font(.caption)
								.foregroundStyle(.secondary)
						}
					}
					if let providerId = aiProviderId {
						Section {
							AIProviderUsageView(providerId: providerId)
						}
					}
					if !isAIProviderConnected {
						Section {
							AIProviderSetupHelpView(section: section)
						}
					}
				}

				if !deleteFields.isEmpty {
					Section("Danger Zone") {
						ForEach(deleteFields) { field in
							LabeledContent(field.label) {
								Button(field.label, role: .destructive) {
									store.requestDelete(for: field, sectionLabel: section.displayLabel)
								}
							}
							Text("This action cannot be undone.")
								.font(.caption)
								.foregroundStyle(.secondary)
						}
					}
				}

				if isIntegrationSection {
					IntegrationSettingsToolsAndGuideSections(store: store, section: section)
				}
			}

			if let errorMessage = store.errorMessage, !store.settingsSections.isEmpty {
				Section {
					InlineStatusMessage(message: errorMessage, tone: .error, font: .caption)
				}
			}
		}
		.tobySettingsFormStyle()
		.task(id: section.key) {
			if isIntegrationSection {
				await store.loadIntegrationStatus(for: section.key)
				await store.loadSetupGuide(for: section.key)
			}
			if isAIProviderSection {
				await store.loadAIProviderStatuses()
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
					Task {
						await store.loadAIProviderStatuses()
						await store.loadSectionDetail(section.key)
					}
				},
				onDismiss: { guidedSetupProviderId = nil }
			)
		}
	}

	private struct GuidedSetupSheetItem: Identifiable {
		let id: String
	}
}
