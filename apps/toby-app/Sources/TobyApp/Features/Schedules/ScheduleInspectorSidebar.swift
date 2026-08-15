import SwiftUI

struct ScheduleInspectorSidebar: View {
    @Bindable var store: SchedulesStore
    let schedule: ScheduleViewModel
    @FocusState private var isCronFieldFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    nameField
                    actionField
                    if isFlowAction {
                        flowField
                    } else {
                        personaField
                        projectField
                    }
                    cronField
                    enableRow
                    Divider().overlay(SettingsDesign.cardBorder)
                    runInfoSection
                    recentRunsSection
                }
                .padding(18)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            Divider().overlay(SettingsDesign.cardBorder)

            HStack(spacing: 10) {
                Button {
                    Task { await store.runSchedule(id: schedule.id) }
                } label: {
                    Label("Run Now", systemImage: "play.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.regular)
                // Do not gate on isSaving — autosave must not flicker these controls.
                .disabled(store.runningScheduleId != nil)
                .accessibilityIdentifier("sidebar-run-now-button")

                Button(role: .destructive) {
                    store.pendingDelete = SchedulesStore.PendingDelete(
                        scheduleId: schedule.id,
                        title: schedule.displayName
                    )
                } label: {
                    Label("Delete…", systemImage: "trash")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.regular)
                .tint(.red)
                .disabled(store.deletingScheduleId != nil)
                .accessibilityIdentifier("sidebar-delete-schedule-button")
            }
            .padding(18)
        }
        .frame(width: 280)
        .background(AppTheme.sidebarBackground)
    }

    private var nameField: some View {
        SkillSidebarField(
            title: "Name",
            placeholder: "Schedule name",
            text: binding(for: .name),
        )
    }

    private var actionField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("When it runs")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(SettingsDesign.rowTitle)
            Picker("When it runs", selection: actionBinding) {
                Text("Prompt").tag("prompt")
                Text("Flow").tag("flow")
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .controlSize(.regular)
            .accessibilityIdentifier("schedule-action-picker")
            Text(
                isFlowAction
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
                Picker("Flow", selection: flowBinding) {
                    Text("Select a flow").tag("(none)")
                    ForEach(store.flowOptions) { flow in
                        Text(flow.builtin ? "\(flow.displayName) (built-in)" : flow.displayName)
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
            HStack {
                Picker("Persona", selection: personaBinding) {
                    ForEach(store.personaOptions, id: \.name) { option in
                        Text(option.label).tag(option.name)
                    }
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .controlSize(.regular)

                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var projectField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Project")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(SettingsDesign.rowTitle)
            HStack {
                Picker("Project", selection: binding(for: .project)) {
                    Text("No project").tag("(none)")
                    ForEach(store.projectOptions) { project in
                        Text(project.name).tag(project.id)
                    }
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .controlSize(.regular)

                Spacer(minLength: 0)
            }
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
            let cronBinding = binding(for: .cron)
            let isParsing = store.isParsingCron(for: schedule.id)
            let isCronValid = store.isCronValid(for: schedule.id)
            let cronText = cronBinding.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines)
            HStack(spacing: 8) {
                SettingsInlineField(text: cronBinding, placeholder: "0 9 * * *")
                    .disabled(isParsing)
                    .focused($isCronFieldFocused)
                    .onChange(of: isCronFieldFocused) { _, isFocused in
                        if !isFocused {
                            store.validateCronOnBlur(for: schedule.id)
                        }
                    }
                Button {
                    Task { await store.parseCron(for: schedule.id) }
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
                .disabled(isParsing || cronBinding.wrappedValue.isEmpty || isCronValid)
                .help(
                    cronBinding.wrappedValue.isEmpty
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
            } else if let error = store.cronValidationErrors[schedule.id], !error.isEmpty {
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
                Text(enabledDescription)
                    .font(.system(size: 11))
                    .foregroundStyle(SettingsDesign.rowDescription)
            }
            Spacer()
            SettingsToggle(isOn: enabledBinding)
        }
    }

    @ViewBuilder
    private var runInfoSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let nextRunText = schedule.nextRunText, schedule.enabled {
                metadataRow(label: "Next run", value: nextRunText)
            }
            if let lastRun = schedule.lastRunAt, !lastRun.isEmpty {
                metadataRow(label: "Last run", value: lastRun)
            }
            if schedule.nextRunText == nil
                && (schedule.lastRunAt == nil || schedule.lastRunAt?.isEmpty == true)
            {
                Text("No runs yet")
                    .font(.system(size: 11))
                    .foregroundStyle(SettingsDesign.rowDescription)
            }
        }
    }

    @ViewBuilder
    private var recentRunsSection: some View {
        if !schedule.recentRuns.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Recent runs")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(SettingsDesign.rowTitle)
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(schedule.recentRuns.enumerated()), id: \.element.id) {
                        index, run in
                        Button {
                            Task { await store.selectRun(id: run.id) }
                        } label: {
                            HStack(spacing: 8) {
                                Circle()
                                    .fill(runStatusColor(run.status))
                                    .frame(width: 8, height: 8)
                                Text(run.label)
                                    .font(.system(size: 12))
                                    .foregroundStyle(SettingsDesign.rowTitle)
                                    .lineLimit(1)
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 10))
                                    .foregroundStyle(SettingsDesign.rowDescription)
                            }
                            .padding(.vertical, 6)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if index < schedule.recentRuns.count - 1 {
                            Rectangle()
                                .fill(SettingsDesign.cardBorder)
                                .frame(height: 1)
                        }
                    }
                }
            }
        }
    }

    private func metadataRow(label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 11))
                .foregroundStyle(SettingsDesign.rowDescription)
            Spacer()
            Text(value)
                .font(.system(size: 11))
                .foregroundStyle(SettingsDesign.rowTitle)
        }
    }

    private func binding(for field: ScheduleField) -> Binding<String> {
        Binding(
            get: { store.value(for: store.key(for: schedule.id, field: field)) },
            set: { store.setDraftValue(store.key(for: schedule.id, field: field), $0) },
        )
    }

    private var isFlowAction: Bool {
        store.value(for: store.key(for: schedule.id, field: .action)) == "flow"
    }

    private var actionBinding: Binding<String> {
        Binding(
            get: { isFlowAction ? "flow" : "prompt" },
            set: { store.setAction($0, for: schedule.id) },
        )
    }

    private var flowBinding: Binding<String> {
        Binding(
            get: {
                let value = store.value(for: store.key(for: schedule.id, field: .flow))
                return value.isEmpty ? "(none)" : value
            },
            set: {
                store.setDraftValue(
                    store.key(for: schedule.id, field: .flow),
                    $0,
                    autosaveImmediately: true,
                )
            },
        )
    }

    private var personaBinding: Binding<String> {
        Binding(
            get: { store.value(for: store.key(for: schedule.id, field: .persona)) },
            set: {
                store.setDraftValue(
                    store.key(for: schedule.id, field: .persona),
                    $0,
                    autosaveImmediately: true,
                )
            },
        )
    }

    private var enabledBinding: Binding<Bool> {
        Binding(
            get: {
                store.value(for: store.key(for: schedule.id, field: .enabled)).lowercased() == "yes"
            },
            set: {
                store.setDraftValue(
                    store.key(for: schedule.id, field: .enabled),
                    $0 ? "Yes" : "No",
                    autosaveImmediately: true,
                )
            },
        )
    }

    private var enabledDescription: String {
        enabledBinding.wrappedValue
            ? "This schedule is currently enabled." : "This schedule is currently disabled."
    }

    private func runStatusColor(_ status: String) -> Color {
        switch status.lowercased() {
        case "success":
            return Color.green
        case "error":
            return Color.red
        case "running":
            return Color.orange
        default:
            return AppTheme.tertiaryText
        }
    }
}
