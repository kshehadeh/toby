import SwiftUI

struct ScheduleEditorSheet: View {
	@Bindable var store: SchedulesStore
	@State private var selectedTab: ScheduleDetailTab = .details

	private var title: String {
		store.editor?.isNew == true ? "New Schedule" : "Edit Schedule"
	}

	var body: some View {
		EditorSheet(
			title: title,
			isSaving: store.isSaving,
			canSave: store.editor?.canSave ?? false,
			isDirty: store.isEditorDirty,
			errorMessage: store.editorError,
			size: .wide,
			accessibilityIdentifier: "schedule-editor-sheet",
			cancelAccessibilityIdentifier: "schedule-editor-cancel",
			saveAccessibilityIdentifier: "schedule-editor-save",
			onCancel: { store.cancelEditor() },
			onSave: { Task { await store.saveEditor() } }
		) {
			if store.editor != nil {
				VStack(spacing: 16) {
					Picker("Section", selection: $selectedTab) {
						Text("Details").tag(ScheduleDetailTab.details)
						Text("Prompt").tag(ScheduleDetailTab.prompt)
					}
					.pickerStyle(.segmented)
					.labelsHidden()
					.frame(maxWidth: 280)
					.accessibilityIdentifier("schedule-editor-tabs")

					ZStack {
						ScheduleEditorDetailsPane(store: store)
							.opacity(selectedTab == .details ? 1 : 0)
							.allowsHitTesting(selectedTab == .details)
							.accessibilityHidden(selectedTab != .details)
						ScheduleEditorPromptPane(store: store)
							.opacity(selectedTab == .prompt ? 1 : 0)
							.allowsHitTesting(selectedTab == .prompt)
							.accessibilityHidden(selectedTab != .prompt)
					}
					.frame(maxWidth: .infinity, maxHeight: .infinity)
					.animation(nil, value: selectedTab)
				}
				.padding(AppTheme.contentPadding)
			}
		}
	}
}

struct ScheduleEditorDetailsPane: View {
	@Bindable var store: SchedulesStore
	@FocusState private var isCronFieldFocused: Bool

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 16) {
				SkillSidebarField(
					title: "Name",
					placeholder: "Schedule name",
					accessibilityIdentifier: "schedule-title-field",
					text: draftBinding(\.name)
				)
				actionField
				if store.editor?.isFlowAction == true {
					flowField
				} else {
					personaField
					projectField
				}
				cronField
				enableRow
			}
			.padding(20)
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.scrollBounceBehavior(.basedOnSize)
		.accessibilityIdentifier("schedule-editor-details")
	}

	private var actionField: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("When it runs")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			Picker("When it runs", selection: draftBinding(\.action)) {
				Text("Prompt").tag("prompt")
				Text("Flow").tag("flow")
			}
			.labelsHidden()
			.pickerStyle(.menu)
			.controlSize(.regular)
			.accessibilityIdentifier("schedule-action-picker")
			.onChange(of: store.editor?.action) { _, action in
				store.applyEditorAction(action ?? "prompt")
			}
			Text(
				store.editor?.isFlowAction == true
					? "Runs the selected flow on this timetable."
					: "Sends the prompt through chat when this timetable fires."
			)
			.font(.system(size: 11))
			.foregroundStyle(SettingsDesign.rowDescription)
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	private var flowField: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Flow")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			if store.flowOptions.isEmpty {
				Text("Create a flow first, then pick it here.")
					.font(.system(size: 11))
					.foregroundStyle(SettingsDesign.rowDescription)
			} else {
				Picker("Flow", selection: draftBinding(\.flowId)) {
					Text("Select a flow").tag("(none)")
					ForEach(store.flowOptions) { flow in
						Label(
							flow.builtin ? "\(flow.displayName) (built-in)" : flow.displayName,
							systemImage: flow.systemImage
						)
						.tag(flow.id)
					}
				}
				.labelsHidden()
				.pickerStyle(.menu)
				.controlSize(.regular)
				.accessibilityIdentifier("schedule-flow-picker")
			}
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	private var personaField: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Persona")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			Picker("Persona", selection: draftBinding(\.personaName)) {
				ForEach(store.personaOptions, id: \.name) { option in
					Text(option.label).tag(option.name)
				}
			}
			.labelsHidden()
			.pickerStyle(.menu)
			.controlSize(.regular)
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	private var projectField: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Project")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			Picker("Project", selection: draftBinding(\.projectId)) {
				Text("No project").tag("(none)")
				ForEach(store.projectOptions) { project in
					Text(project.name).tag(project.id)
				}
			}
			.labelsHidden()
			.pickerStyle(.menu)
			.controlSize(.regular)
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	private var cronField: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Schedule")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			VStack(alignment: .leading, spacing: 4) {
				Text(
					"Accepts a cron expression or a plain-language description like \u{201C}every weekday at 9am\u{201D}."
				)
				.font(.system(size: 11))
				.foregroundStyle(SettingsDesign.rowDescription)
				Link(
					"Learn how to write a crontab",
					destination: URL(string: "https://crontab.guru")!
				)
				.font(.system(size: 11))
				.foregroundStyle(AppTheme.accent)
			}
			let cronText = store.editor?.cron.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
			let isParsing = store.isParsingEditorCron
			let isCronValid = store.isEditorCronValid
			HStack(spacing: 8) {
				SettingsInlineField(text: draftBinding(\.cron), placeholder: "0 9 * * *")
					.disabled(isParsing)
					.focused($isCronFieldFocused)
					.onChange(of: isCronFieldFocused) { _, isFocused in
						if !isFocused {
							store.validateEditorCronOnBlur()
						}
					}
				Button {
					Task { await store.parseEditorCron() }
				} label: {
					if isParsing {
						ProgressView()
							.controlSize(.small)
					} else if isCronValid {
						Label("Valid", systemImage: "checkmark.circle.fill")
					} else {
						Label("Convert", systemImage: "sparkles")
					}
				}
				.buttonStyle(.bordered)
				.controlSize(.regular)
				.frame(width: 96)
				.disabled(isParsing || cronText.isEmpty || isCronValid)
				.help(
					cronText.isEmpty
						? "Enter a schedule expression"
						: isCronValid ? "Valid crontab" : "Convert to valid crontab"
				)
				.accessibilityIdentifier("validate-schedule-button")
			}
			if isParsing {
				HStack(spacing: 6) {
					ProgressView()
						.controlSize(.mini)
					Text("Converting natural language to cron…")
						.font(.system(size: 11))
						.foregroundStyle(SettingsDesign.rowDescription)
				}
				.accessibilityIdentifier("cron-converting-status")
			} else if let error = store.editorCronError, !error.isEmpty {
				InlineStatusMessage(message: error, tone: .error, font: .system(size: 11))
			} else if !cronText.isEmpty && !isCronValid {
				Text("Click Convert to turn this into a cron expression.")
					.font(.system(size: 11))
					.foregroundStyle(SettingsDesign.rowDescription)
					.accessibilityIdentifier("cron-needs-convert-hint")
			}
		}
	}

	private var enableRow: some View {
		HStack {
			VStack(alignment: .leading, spacing: 2) {
				Text("Enabled")
					.font(.system(size: 12, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)
				Text(
					store.editor?.enabled == true
						? "This schedule is currently enabled."
						: "This schedule is currently disabled."
				)
				.font(.system(size: 11))
				.foregroundStyle(SettingsDesign.rowDescription)
			}
			Spacer()
			SettingsToggle(isOn: draftBinding(\.enabled))
		}
	}

	private func draftBinding<Value>(_ keyPath: WritableKeyPath<ScheduleEditorDraft, Value>) -> Binding<Value> {
		editorDraftFieldBinding($store.editor, keyPath, fallback: .blank())
	}
}

struct ScheduleEditorPromptPane: View {
	@Bindable var store: SchedulesStore

	var body: some View {
		Group {
			if store.editor?.isFlowAction == true {
				flowPromptSummary
			} else {
				VStack(alignment: .leading, spacing: 8) {
					Text("Sent to Toby when this schedule runs")
						.font(.caption)
						.foregroundStyle(SettingsDesign.rowDescription)
					SkillMarkdownEditor(text: editorDraftFieldBinding($store.editor, \.prompt, fallback: .blank()))
						.frame(maxWidth: .infinity, maxHeight: .infinity)
				}
			}
		}
		.padding(20)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.accessibilityIdentifier("schedule-editor-prompt")
	}

	private var flowPromptSummary: some View {
		VStack(alignment: .leading, spacing: 12) {
			Text("This schedule runs the selected flow instead of a chat prompt.")
				.font(.caption)
				.foregroundStyle(SettingsDesign.rowDescription)
			if let flow = store.flow(for: store.editor?.flowId) {
				VStack(alignment: .leading, spacing: 8) {
					HStack(spacing: 8) {
						Image(systemName: flow.systemImage)
							.foregroundStyle(AppTheme.accent)
						Text(flow.displayName)
							.font(.system(size: 16, weight: .semibold))
							.foregroundStyle(SettingsDesign.rowTitle)
						if flow.builtin {
							Text("Built-in")
								.font(.system(size: 10, weight: .semibold))
								.foregroundStyle(SettingsDesign.rowDescription)
						}
					}
					Text(flow.subtitle)
						.font(.system(size: 12))
						.foregroundStyle(SettingsDesign.rowDescription)
				}
			} else {
				Text("Select a flow on the Details tab.")
					.font(.system(size: 12))
					.foregroundStyle(SettingsDesign.rowDescription)
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
	}
}

