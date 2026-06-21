import SwiftUI

struct ConfigureView: View {
	@Bindable var store: ConfigureStore

	var body: some View {
		NavigationSplitView {
			ConfigureSidebarView(store: store)
				.navigationSplitViewColumnWidth(min: 220, ideal: 240, max: 280)
		} detail: {
			ConfigureDetailView(store: store)
		}
		.frame(minWidth: 860, minHeight: 560)
		.background(SettingsDesign.canvasBackground)
		.task {
			await store.load()
		}
		.onDisappear {
			Task { await store.flushPendingSave() }
		}
		.alert(
			store.pendingDelete?.title ?? "",
			isPresented: Binding(
				get: { store.pendingDelete != nil },
				set: { if !$0 { store.pendingDelete = nil } },
			),
		) {
			Button("Cancel", role: .cancel) {
				store.pendingDelete = nil
			}
			Button(store.pendingDelete?.confirmLabel ?? "Delete", role: .destructive) {
				Task { await store.confirmDelete() }
			}
		} message: {
			Text(store.pendingDelete?.message ?? "")
		}
		.sheet(
			isPresented: Binding(
				get: { store.setupGuidePresented },
				set: { if !$0 { store.dismissSetupGuide() } },
			),
		) {
			if let section = store.selectedSection {
				IntegrationSetupWizardView(store: store, section: section)
			}
		}
	}
}

private struct ConfigureSidebarView: View {
	@Bindable var store: ConfigureStore

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 2) {
				ForEach(store.sidebarTree) { node in
					ConfigureSidebarNodeView(store: store, node: node)
				}
			}
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(10)
		}
		.background(AppTheme.sidebarBackground)
	}
}

private struct ConfigureSidebarNodeView: View {
	@Bindable var store: ConfigureStore
	let node: SidebarTreeNode

	private var isSelected: Bool {
		store.selectedNavKey == node.navKey
	}

	private var iconName: String {
		SettingsSidebarIcon.systemName(for: node.item)
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 2) {
			Button {
				store.selectSection(node.navKey)
			} label: {
				HStack(spacing: 8) {
					Color.clear.frame(width: 22)
					Image(systemName: iconName)
						.font(.callout)
						.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.tertiaryText)
						.frame(width: 18)
						.accessibilityHidden(true)
					Text(node.item.label)
						.font(.callout)
						.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
						.lineLimit(1)
					Spacer(minLength: 0)
				}
				.frame(maxWidth: .infinity, alignment: .leading)
				.padding(.vertical, 6)
				.padding(.horizontal, 8)
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.background(
				RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
					.fill(isSelected ? SettingsDesign.sidebarSelection : Color.clear)
			)
			.overlay(alignment: .leading) {
				if !node.children.isEmpty {
					Button {
						store.toggleExpanded(node.navKey)
					} label: {
						Image(systemName: "chevron.right")
							.font(.caption2.weight(.semibold))
							.foregroundStyle(AppTheme.tertiaryText)
							.rotationEffect(.degrees(store.expandedKeys.contains(node.navKey) ? 90 : 0))
							.frame(width: 22, height: 28)
							.contentShape(Rectangle())
					}
					.buttonStyle(.plain)
					.padding(.leading, 8)
				}
			}
			.frame(maxWidth: .infinity, alignment: .leading)

			if store.expandedKeys.contains(node.navKey) {
				VStack(alignment: .leading, spacing: 2) {
					ForEach(node.children) { child in
						ConfigureSidebarNodeView(store: store, node: child)
							.padding(.leading, 14)
					}
				}
			}
		}
	}
}

private enum SettingsSidebarIcon {
	static func systemName(for item: SettingsItem) -> String {
		let key = item.key.lowercased()
		let label = item.label.lowercased()

		if key == "personas" || key.hasPrefix("personas.") {
			return "person.crop.circle"
		}
		if key == "schedules" || key.hasPrefix("schedules.") {
			return "calendar"
		}
		if key == "skills" || key.hasPrefix("skills.") {
			return "wand.and.stars"
		}
		if key == "projects" || key.hasPrefix("projects.") {
			return "folder"
		}
		if key == "listen" || key.hasPrefix("listen.") {
			return "mic"
		}
		if key.contains(".ai.") || label.contains("model") || label.contains("provider") {
			return "cpu"
		}
		if label.contains("integration") || label.contains("plugin") {
			return "puzzlepiece.extension"
		}
		if label.contains("ai") {
			return "sparkles"
		}
		return "gearshape"
	}
}

private struct ConfigureDetailView: View {
	@Bindable var store: ConfigureStore

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 20) {
				if store.isLoading && store.tree == nil {
					ProgressView("Loading configuration…")
						.frame(maxWidth: .infinity, minHeight: 240)
				} else if let errorMessage = store.errorMessage, store.tree == nil {
					ContentUnavailableView {
						Label("Configuration unavailable", systemImage: "exclamationmark.triangle")
					} description: {
						Text(errorMessage)
					}
				} else if let section = store.selectedSection {
					ConfigureSectionDetailView(store: store, section: section)
				} else {
					Text("Select a section")
						.foregroundStyle(SettingsDesign.rowDescription)
				}

				if let errorMessage = store.errorMessage, store.tree != nil {
					Text(errorMessage)
						.font(.caption)
						.foregroundStyle(.red)
				}
			}
			.frame(maxWidth: SettingsDesign.contentMaxWidth)
			.frame(maxWidth: .infinity)
			.padding(.horizontal, 32)
			.padding(.vertical, 28)
		}
		.background(SettingsDesign.canvasBackground)
	}
}

private struct ConfigureSectionDetailView: View {
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

			if ConfigureTreeHelpers.isContainerSection(section) {
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

private struct IntegrationDetailHeader: View {
	@Bindable var store: ConfigureStore
	let section: SettingsItem
	let status: IntegrationStatus?
	let isLoading: Bool
	let isActionLoading: Bool
	let onAction: (IntegrationAction) -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 14) {
			HStack(spacing: 14) {
				RoundedRectangle(cornerRadius: 12)
					.fill(AppTheme.accent.opacity(0.18))
					.frame(width: 48, height: 48)
					.overlay {
						Image(systemName: "puzzlepiece.extension")
							.font(.system(size: 22, weight: .medium))
							.foregroundStyle(AppTheme.accent)
					}
				VStack(alignment: .leading, spacing: 4) {
					Text(section.label)
						.font(.title3.weight(.semibold))
						.foregroundStyle(AppTheme.primaryText)
					statusLine
				}
			}

			if let status {
				if let pluginPath = status.pluginPath {
					Text("Plugin: \(pluginPath)")
						.font(.caption)
						.foregroundStyle(AppTheme.tertiaryText)
						.textSelection(.enabled)
				}

				if let health = status.health, let details = health.details, !details.isEmpty {
					Text(details)
						.font(.subheadline)
						.foregroundStyle(health.ok ? Color.green.opacity(0.85) : Color.red.opacity(0.85))
						.fixedSize(horizontal: false, vertical: true)
				}

				HStack(spacing: 10) {
					SettingsActionButton(title: "Setup Guide") {
						Task {
							await store.loadSetupGuide(for: section.key)
						}
					}
					.disabled(isActionLoading)
					if !status.connected {
						SettingsActionButton(title: "Connect") {
							onAction(.connect)
						}
						.disabled(isActionLoading)
					}
					if status.connected {
						SettingsActionButton(title: "Disconnect") {
							onAction(.disconnect)
						}
						.disabled(isActionLoading)
						SettingsActionButton(title: status.reconnectionLabel) {
							onAction(.reauthorize)
						}
						.disabled(isActionLoading)
					}
					if status.supportsSetup {
						SettingsActionButton(title: "Run Setup") {
							onAction(.setup)
						}
						.disabled(isActionLoading)
					}
				}
				.padding(.top, 4)
			}
		}
	}

	@ViewBuilder
	private var statusLine: some View {
		if isLoading {
			HStack(spacing: 6) {
				ProgressView()
					.scaleEffect(0.7)
				Text("Checking status…")
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)
			}
		} else if let status {
			HStack(spacing: 6) {
				Circle()
					.fill(status.connected ? (healthOk ? Color.green : Color.red) : AppTheme.tertiaryText)
					.frame(width: 6, height: 6)
				Text(statusText)
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)
			}
		} else {
			HStack(spacing: 6) {
				Circle()
					.fill(AppTheme.tertiaryText)
					.frame(width: 6, height: 6)
				Text("Status unavailable")
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)
			}
		}
	}

	private var healthOk: Bool {
		guard let status else { return false }
		return status.connected && (status.health?.ok ?? false)
	}

	private var statusText: String {
		guard let status else { return "Status unavailable" }
		if status.connected {
			if let health = status.health, !(health.ok) {
				return "Connected · Authentication invalid"
			}
			return "Connected · Authentication valid"
		}
		return "Not connected"
	}
}

struct ConfigureFieldRowView: View {
	@Bindable var store: ConfigureStore
	let field: SettingsItem
	let sectionLabel: String
	let showsDivider: Bool

	var body: some View {
		SettingsRow(
			title: field.label,
			description: fieldDescription,
			showsDivider: showsDivider,
		) {
			fieldControl
		}
	}

	@ViewBuilder
	private var fieldControl: some View {
		switch field.kind {
		case .action:
			if let action = ConfigureTreeHelpers.actionForKey(field.key) {
				SettingsActionButton(title: actionButtonTitle, showsExternalIcon: false) {
					Task { await store.runAction(action.name, body: action.body) }
				}
				.disabled(store.isSaving)
			}
		case .select:
			if let options = field.options, !options.isEmpty {
				if ConfigureTreeHelpers.isBooleanSelectField(field) {
					SettingsToggle(isOn: booleanBinding)
				} else {
					selectMenu(options: options)
				}
			}
		case .multiSelect:
			multiSelectMenu
		default:
			if field.masked == true {
				SettingsInlineField(
					text: maskedDraftBinding,
					isSecure: true,
					placeholder: maskedPlaceholder,
				)
			} else if field.kind == .value || field.kind == .select {
				SettingsInlineField(text: draftBinding, placeholder: "Enter value")
			} else if field.readOnly == true {
				Text(store.value(for: field.key).isEmpty ? "Not set" : "Configured")
					.font(.body)
					.foregroundStyle(SettingsDesign.rowDescription)
			}
		}
	}

	private var actionButtonTitle: String {
		switch field.key {
		case "personas._new", "schedules._new":
			return "Create"
		default:
			if field.key.hasSuffix("._setDefault") {
				return "Set Default"
			}
			return field.label
		}
	}

	private var fieldDescription: String? {
		if field.masked == true,
			store.value(for: field.key) == ConfigureConstants.redactedSecret,
			store.draft[field.key] == nil
		{
			return "A value is saved. Enter a new value to replace it."
		}
		if field.kind == .select, ConfigureTreeHelpers.isBooleanSelectField(field) {
			return booleanBinding.wrappedValue
				? "This setting is currently enabled."
				: "This setting is currently disabled."
		}
		return nil
	}

	private var maskedPlaceholder: String {
		if store.value(for: field.key) == ConfigureConstants.redactedSecret,
			store.draft[field.key] == nil
		{
			return "••••••"
		}
		return "Enter value"
	}

	private func selectMenu(options: [String]) -> some View {
		Menu {
			ForEach(selectOptions(options), id: \.value) { option in
				Button(option.label) {
					store.setDraftValue(field.key, option.value, autosaveImmediately: true)
				}
			}
		} label: {
			SettingsDropdownLabel(title: currentSelectLabel(options: options))
		}
		.menuStyle(.borderlessButton)
		.fixedSize()
	}

	private var multiSelectMenu: some View {
		let choices = field.selectChoices ?? field.options?.map {
			SettingsSelectChoice(value: $0, label: $0)
		} ?? []
		return Menu {
			ForEach(choices, id: \.value) { choice in
				Button {
					toggleMultiSelectValue(choice.value)
				} label: {
					if multiSelectValues.contains(choice.value) {
						Label(choice.label, systemImage: "checkmark")
					} else {
						Text(choice.label)
					}
				}
			}
		} label: {
			SettingsDropdownLabel(title: multiSelectSummary(from: choices))
		}
		.menuStyle(.borderlessButton)
		.fixedSize()
	}

	private var multiSelectValues: Set<String> {
		let raw = store.draft[field.key] ?? store.savedValues[field.key] ?? ""
		return Set(
			raw.split(separator: ",")
				.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
				.filter { !$0.isEmpty },
		)
	}

	private func toggleMultiSelectValue(_ value: String) {
		var next = multiSelectValues
		if next.contains(value) {
			next.remove(value)
		} else {
			next.insert(value)
		}
		store.setDraftValue(field.key, next.sorted().joined(separator: ","), autosaveImmediately: true)
	}

	private func multiSelectSummary(from choices: [SettingsSelectChoice]) -> String {
		let selected = choices.filter { multiSelectValues.contains($0.value) }
		if selected.isEmpty { return "None" }
		if selected.count == 1 { return selected[0].label }
		return "\(selected.count) selected"
	}

	private func currentSelectLabel(options: [String]) -> String {
		let value = store.value(for: field.key)
		return selectOptions(options).first(where: { $0.value == value })?.label ?? value
	}

	private var booleanBinding: Binding<Bool> {
		Binding(
			get: {
				let value = store.value(for: field.key).lowercased()
				return value == "yes" || value == "true"
			},
			set: { enabled in
				store.setDraftValue(field.key, enabled ? "Yes" : "No", autosaveImmediately: true)
			},
		)
	}

	private var draftBinding: Binding<String> {
		Binding(
			get: { store.value(for: field.key) },
			set: { store.setDraftValue(field.key, $0) },
		)
	}

	private var maskedDraftBinding: Binding<String> {
		Binding(
			get: {
				if let draftValue = store.draft[field.key] {
					return draftValue
				}
				let saved = store.savedValues[field.key] ?? ""
				return saved == ConfigureConstants.redactedSecret ? "" : saved
			},
			set: { store.setDraftValue(field.key, $0) },
		)
	}

	private func selectOptions(_ options: [String]) -> [SettingsSelectChoice] {
		if let choices = field.selectChoices, !choices.isEmpty {
			return choices
		}
		return options.map { option in
			let label = store.integrationLabels[option] ?? option
			return SettingsSelectChoice(value: option, label: label)
		}
	}
}

struct ConfigureBlockFieldView: View {
	@Bindable var store: ConfigureStore
	let field: SettingsItem
	let sectionLabel: String

	var body: some View {
		SettingsCard {
			VStack(alignment: .leading, spacing: 12) {
				Text(field.label)
					.font(.body)
					.foregroundStyle(SettingsDesign.rowTitle)

				if field.kind == .hint {
					Text(field.currentValue ?? store.value(for: field.key))
						.font(.subheadline)
						.foregroundStyle(SettingsDesign.rowDescription)
						.textSelection(.enabled)
						.frame(maxWidth: .infinity, alignment: .leading)
				} else if field.multiline == true {
					TextEditor(text: draftBinding)
						.font(.body.monospaced())
						.foregroundStyle(SettingsDesign.rowTitle)
						.scrollContentBackground(.hidden)
						.frame(minHeight: 140)
						.padding(10)
						.background(
							RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
								.fill(SettingsDesign.canvasBackground.opacity(0.55))
						)
						.overlay {
							RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
								.stroke(SettingsDesign.controlBorder, lineWidth: 1)
						}
				} else if field.readOnly == true {
					Text(store.value(for: field.key).isEmpty ? "Not set" : "Configured")
						.font(.subheadline)
						.foregroundStyle(SettingsDesign.rowDescription)
				}
			}
			.padding(SettingsDesign.rowHorizontalPadding)
			.padding(.vertical, SettingsDesign.rowVerticalPadding)
		}
	}

	private var draftBinding: Binding<String> {
		Binding(
			get: { store.value(for: field.key) },
			set: { store.setDraftValue(field.key, $0) },
		)
	}
}
