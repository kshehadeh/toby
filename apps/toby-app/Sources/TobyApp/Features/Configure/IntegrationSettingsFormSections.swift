import SwiftUI

// MARK: - Field layout

/// Splits an integration's visible fields into the sections the form shows:
/// "Sign in" (the method picker plus that method's fields), one section per
/// plugin `group`, and "Mentions" (the inbound toggle plus fields that only
/// matter while it is on).
struct IntegrationFormLayout: Equatable {
	struct FieldGroup: Equatable, Identifiable {
		let title: String
		let fields: [SettingsItem]
		var id: String { title }

		static func == (lhs: FieldGroup, rhs: FieldGroup) -> Bool {
			lhs.title == rhs.title && lhs.fields.map(\.key) == rhs.fields.map(\.key)
		}
	}

	var authField: SettingsItem?
	var methodFields: [SettingsItem]
	var groups: [FieldGroup]
	var inboundField: SettingsItem?
	var inboundFields: [SettingsItem]

	static func == (lhs: IntegrationFormLayout, rhs: IntegrationFormLayout) -> Bool {
		lhs.authField?.key == rhs.authField?.key
			&& lhs.methodFields.map(\.key) == rhs.methodFields.map(\.key)
			&& lhs.groups == rhs.groups
			&& lhs.inboundField?.key == rhs.inboundField?.key
			&& lhs.inboundFields.map(\.key) == rhs.inboundFields.map(\.key)
	}

	static let ungroupedTitle = "Settings"

	init(sectionKey: String, fields: [SettingsItem], selectedAuthMethod: String) {
		let auth = fields.first { $0.key == "\(sectionKey).authMethod" }
		let inbound = fields.first { $0.key == "\(sectionKey).inboundEnabled" }
		let rest = fields.filter { $0.key != auth?.key && $0.key != inbound?.key }

		let method = rest.filter { field in
			auth != nil && (field.showForAuthMethods ?? []).contains(selectedAuthMethod)
		}
		let methodKeys = Set(method.map(\.key))
		let inboundOnly = inbound == nil
			? []
			: rest.filter { !methodKeys.contains($0.key) && $0.showForInbound == true }
		let inboundKeys = Set(inboundOnly.map(\.key))

		var order: [String] = []
		var buckets: [String: [SettingsItem]] = [:]
		for field in rest where !methodKeys.contains(field.key) && !inboundKeys.contains(field.key) {
			let trimmed = field.group?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
			let title = trimmed.isEmpty ? IntegrationFormLayout.ungroupedTitle : trimmed
			if buckets[title] == nil { order.append(title) }
			buckets[title, default: []].append(field)
		}

		authField = auth
		inboundField = inbound
		methodFields = method
		inboundFields = inboundOnly
		groups = order.map { FieldGroup(title: $0, fields: buckets[$0] ?? []) }
	}
}

/// The integration's settings, laid out like System Settings.
struct IntegrationSettingsFieldSections: View {
	@Bindable var store: ConfigureStore
	let section: SettingsItem
	let fields: [SettingsItem]

	private var layout: IntegrationFormLayout {
		IntegrationFormLayout(
			sectionKey: section.key,
			fields: fields,
			selectedAuthMethod: store.resolvedAuthMethod(for: section)
		)
	}

	var body: some View {
		let layout = self.layout
		Group {
			if let authField = layout.authField {
				Section("Sign in") {
					LabeledContent("Method") {
						Picker("Method", selection: methodBinding(authField)) {
							ForEach(authField.selectChoices ?? [], id: \.value) { choice in
								Text(IntegrationHeaderState.methodName(choice.label)).tag(choice.value)
							}
						}
						.labelsHidden()
						.pickerStyle(.segmented)
						.fixedSize()
						.accessibilityIdentifier("integration-auth-method")
					}
					fieldRows(layout.methodFields)
				}
			}

			ForEach(layout.groups) { group in
				Section(group.title) {
					fieldRows(group.fields)
				}
			}

			if let inboundField = layout.inboundField {
				Section("Mentions") {
					ConfigureFieldRowView(
						store: store,
						field: inboundField,
						sectionLabel: section.displayLabel,
						showsDivider: false,
						usesFormChrome: true,
					)
					if store.isInboundEnabled(for: section) {
						fieldRows(layout.inboundFields)
					}
				}
			}
		}
	}

	@ViewBuilder
	private func fieldRows(_ rows: [SettingsItem]) -> some View {
		ForEach(rows) { field in
			ConfigureFieldRowView(
				store: store,
				field: field,
				sectionLabel: section.displayLabel,
				showsDivider: false,
				usesFormChrome: true,
			)
		}
	}

	private func methodBinding(_ field: SettingsItem) -> Binding<String> {
		Binding(
			get: { store.resolvedAuthMethod(for: section) },
			set: { store.setDraftValue(field.key, $0, autosaveImmediately: true) }
		)
	}
}

// MARK: - Tools

/// "What Toby can do in …": every tool with an icon for what it does, the
/// first sentence of its description, and a tag on tools that change things.
struct IntegrationSettingsToolsAndGuideSections: View {
	@Bindable var store: ConfigureStore
	let section: SettingsItem
	@State private var showsAllTools = false

	static let collapsedCount = 3

	private var tools: [IntegrationToolDefinition] {
		store.integrationStatus[section.key]?.tools ?? []
	}

	@ViewBuilder
	var body: some View {
		let tools = self.tools
		if !tools.isEmpty {
			let visible = showsAllTools ? tools : Array(tools.prefix(Self.collapsedCount))
			Section {
				ForEach(visible) { tool in
					IntegrationToolRow(sectionKey: section.key, tool: tool)
				}
				if tools.count > Self.collapsedCount {
					Button(showsAllTools ? "Show fewer" : "Show all \(tools.count) tools") {
						showsAllTools.toggle()
					}
					.buttonStyle(.link)
					.frame(maxWidth: .infinity, alignment: .leading)
					.accessibilityIdentifier("integration-tools-toggle")
				}
			} header: {
				HStack(alignment: .firstTextBaseline, spacing: 8) {
					Text("What Toby can do in \(section.label)")
					Text(Self.countLabel(tools))
						.font(.system(size: 12, weight: .regular))
						.foregroundStyle(AppTheme.tertiaryText)
				}
			}
		}
	}

	static func countLabel(_ tools: [IntegrationToolDefinition]) -> String {
		let count = tools.count == 1 ? "1 tool" : "\(tools.count) tools"
		return tools.allSatisfy({ $0.readOnly == true }) ? "\(count) · read only" : count
	}
}

private struct IntegrationToolRow: View {
	let sectionKey: String
	let tool: IntegrationToolDefinition

	var body: some View {
		HStack(alignment: .top, spacing: 12) {
			Image(systemName: FlowToolPickerModel.actionSymbol(for: FlowCatalogTool(moduleName: sectionKey, tool: tool)))
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(AppTheme.accent)
				.frame(width: 28, height: 28)
				.background(AppTheme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
				.accessibilityHidden(true)
			VStack(alignment: .leading, spacing: 2) {
				HStack(spacing: 8) {
					Text(tool.displayName)
						.font(.system(size: 13, weight: .medium))
					if tool.readOnly == false {
						Text("Makes changes")
							.font(.system(size: 10, weight: .semibold))
							.foregroundStyle(AppTheme.secondaryText)
							.padding(.horizontal, 6)
							.padding(.vertical, 1)
							.background(Capsule().fill(AppTheme.primaryText.opacity(0.07)))
					}
				}
				if let description = FlowEditorText.firstSentence(tool.description) {
					Text(description)
						.font(.system(size: 12))
						.foregroundStyle(.secondary)
						.fixedSize(horizontal: false, vertical: true)
				}
			}
			Spacer(minLength: 0)
		}
		.padding(.vertical, 2)
		.frame(maxWidth: .infinity, alignment: .leading)
		.accessibilityElement(children: .combine)
	}
}

// MARK: - About and disconnect

/// Setup guide, setup command and plugin location, then Disconnect (and
/// Remove for MCP servers) as destructive rows at the very bottom.
struct IntegrationSettingsAboutSections: View {
	@Bindable var store: ConfigureStore
	let section: SettingsItem
	let status: IntegrationStatus?
	let isActionLoading: Bool
	let onAction: (IntegrationAction) -> Void
	var onRemove: (() -> Void)? = nil
	var onOpenSetupGuide: (() -> Void)? = nil

	private var isRemoving: Bool {
		store.integrationActionLoading == "\(section.key).remove"
	}

	@ViewBuilder
	var body: some View {
		if let status {
			Section("About") {
				LabeledContent("Setup guide") {
					Button(onOpenSetupGuide != nil && section.key == "slack" ? "Set up…" : "Open") {
						if let onOpenSetupGuide {
							onOpenSetupGuide()
						} else {
							Task { await store.presentSetupGuide(for: section.key) }
						}
					}
					.disabled(isActionLoading)
					.accessibilityIdentifier(
						section.key == "news" && onOpenSetupGuide != nil
							? "news-setup-guide-button"
							: "integration-setup-guide-button"
					)
				}
				if status.supportsSetup {
					LabeledContent("Setup") {
						Button("Run setup") { onAction(.setup) }
							.disabled(isActionLoading)
					}
				}
				if let pluginPath = status.pluginPath, !pluginPath.isEmpty {
					LabeledContent("Plugin") {
						HStack(spacing: 10) {
							Text(Self.abbreviated(pluginPath))
								.font(.system(size: 11, design: .monospaced))
								.foregroundStyle(.secondary)
								.lineLimit(1)
								.truncationMode(.middle)
								.help(pluginPath)
							Button("Show in Finder") {
								RevealInFinder.reveal(path: pluginPath)
							}
							.accessibilityLabel("Show plugin folder in Finder")
							.accessibilityValue(pluginPath)
						}
					}
				}
			}
		}

		if status?.connected == true || (section.isMcpConnection && onRemove != nil) {
			Section {
				if status?.connected == true {
					Button("Disconnect \(section.label)", role: .destructive) {
						onAction(.disconnect)
					}
					.disabled(isActionLoading)
					.frame(maxWidth: .infinity, alignment: .leading)
					.accessibilityIdentifier("integration-disconnect-button")
				}
				if section.isMcpConnection, let onRemove {
					Button("Remove \(section.label)…", role: .destructive) {
						onRemove()
					}
					.disabled(isRemoving)
					.frame(maxWidth: .infinity, alignment: .leading)
					.accessibilityIdentifier("integration-remove-button")
				}
			}
		}
	}

	/// `/Users/me/dev/x` → `~/dev/x`.
	static func abbreviated(_ path: String) -> String {
		let home = FileManager.default.homeDirectoryForCurrentUser.path
		guard !home.isEmpty, path.hasPrefix(home) else { return path }
		return "~" + path.dropFirst(home.count)
	}
}
