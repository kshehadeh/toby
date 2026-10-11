import SwiftUI
import AppKit

/// "When": one card per trigger. Each card leads with what starts the flow
/// in plain words, shows the few fields that define it, and keeps days,
/// hours and rate limits behind "Limits and timing".
struct FlowTriggersEditor: View {
    @Binding var triggers: [FlowTriggerSpec]
    @Binding var invalidFields: Set<String>

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("When")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(SettingsDesign.rowTitle)
                Text("What starts this flow. A flow can have more than one trigger.")
                    .font(.system(size: 12))
                    .foregroundStyle(SettingsDesign.rowDescription)
            }
            ForEach($triggers) { $trigger in
                FlowTriggerCard(trigger: $trigger, invalidFields: $invalidFields) {
                    let id = trigger.id
                    invalidFields = invalidFields.filter { !$0.hasPrefix(id + ":") }
                    triggers.removeAll { $0.id == id }
                }
            }
            Button {
                var trigger = FlowTriggerSpec.manual()
                trigger.name = "New trigger"
                triggers.append(trigger)
            } label: {
                Label("Add trigger", systemImage: "plus")
                    .font(.system(size: 12, weight: .medium))
                    .padding(.horizontal, 11)
                    .frame(height: 26)
                    .background(Capsule().fill(AppTheme.primaryText.opacity(0.06)))
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("flow-editor-add-trigger")
        }
        .accessibilityIdentifier("flow-triggers-editor")
    }
}

// MARK: - Trigger card

private struct FlowTriggerCard: View {
    @Binding var trigger: FlowTriggerSpec
    @Binding var invalidFields: Set<String>
    let onRemove: () -> Void

    @State private var showsLimits = false
    @State private var showsInputs = false
    @State private var isRenaming = false
    @State private var newName = ""

    struct TriggerType: Identifiable {
        let id: String
        let label: String
        let symbol: String
    }

    static let types = [
        TriggerType(id: "manual", label: "Manually", symbol: "hand.tap"),
        TriggerType(id: "home.action", label: "From a Home button", symbol: "house"),
        TriggerType(id: "dashboard.refresh", label: "When Home refreshes", symbol: "arrow.clockwise"),
        TriggerType(id: "schedule", label: "On a schedule", symbol: "calendar.badge.clock"),
        TriggerType(id: "macos.didWake", label: "When the Mac wakes", symbol: "sun.max"),
        TriggerType(id: "macos.userReturned", label: "When I come back to the Mac", symbol: "person.wave.2"),
        TriggerType(id: "macos.fileChanges", label: "When files change", symbol: "folder"),
    ]

    private var typeInfo: TriggerType {
        Self.types.first(where: { $0.id == trigger.source.type })
            ?? TriggerType(id: trigger.source.type, label: trigger.label, symbol: "bolt")
    }

    private var hasInvalidInputs: Bool {
        invalidFields.contains { $0.hasPrefix(trigger.id + ":") }
    }

    private var subtitle: String {
        trigger.hasCustomName ? "\(trigger.name) · \(trigger.plainSummary)" : trigger.plainSummary
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(.leading, 16)
                .padding(.trailing, 12)
                .padding(.vertical, 12)

            if hasMainFields {
                hairline.padding(.leading, 58)
                mainFields
                    .padding(.leading, 58)
                    .padding(.trailing, 16)
                    .padding(.vertical, 12)
            }

            if trigger.isEventDriven {
                hairline
                limitsHeader
                if showsLimits {
                    limitsFields
                        .padding(.leading, 58)
                        .padding(.trailing, 16)
                        .padding(.bottom, 14)
                }
            }

            if hasInvalidInputs {
                hairline
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .symbolRenderingMode(.multicolor)
                        .font(.system(size: 11))
                    Text("This trigger’s inputs aren’t valid JSON, so the flow can’t be saved.")
                        .font(.system(size: 12))
                        .foregroundStyle(SettingsDesign.rowTitle)
                    Spacer(minLength: 8)
                    Button("Fix inputs…") { showsInputs = true }
                        .controlSize(.small)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 9)
            }

            if trigger.source.type.hasPrefix("macos.") {
                hairline
                Label("Toby needs to be open to notice this. Anything that happens while it’s closed is missed.", systemImage: "info.circle")
                    .font(.system(size: 11))
                    .foregroundStyle(SettingsDesign.rowDescription)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 9)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .flowEditorCard()
        .onChange(of: trigger) { old, new in
            var synced = new
            synced.syncDefaultName(from: old)
            if synced.name != new.name { trigger.name = synced.name }
        }
        .sheet(isPresented: $showsInputs) {
            FlowTriggerInputsSheet(trigger: $trigger, validation: validation)
        }
        .alert("Rename trigger", isPresented: $isRenaming) {
            TextField("Name", text: $newName)
            Button("Save") {
                let trimmed = newName.trimmingCharacters(in: .whitespacesAndNewlines)
                trigger.name = String((trimmed.isEmpty ? trigger.plainSummary : trimmed).prefix(200))
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The name appears in run history. Leave it empty to describe the trigger automatically.")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("flow-trigger-\(trigger.id)")
    }

    private var hairline: some View {
        Rectangle()
            .fill(SettingsDesign.cardBorder)
            .frame(height: 1)
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: typeInfo.symbol)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(AppTheme.accent)
                .frame(width: 30, height: 30)
                .background(AppTheme.accent.opacity(0.13), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 1) {
                Menu {
                    Picker("Starts", selection: Binding(
                        get: { trigger.source.type },
                        set: { trigger.changeSource($0) }
                    )) {
                        ForEach(Self.types) { type in
                            Label(type.label, systemImage: type.symbol).tag(type.id)
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                } label: {
                    HStack(spacing: 5) {
                        Text(typeInfo.label)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(SettingsDesign.rowTitle)
                        Image(systemName: "chevron.up.chevron.down")
                            .font(.system(size: 8, weight: .bold))
                            .foregroundStyle(AppTheme.secondaryText)
                    }
                    .contentShape(Rectangle())
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
                .accessibilityLabel("Starts: \(typeInfo.label)")
                .accessibilityIdentifier("flow-trigger-type")

                Text(subtitle)
                    .font(.system(size: 12))
                    .foregroundStyle(SettingsDesign.rowDescription)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            Spacer(minLength: 8)

            Toggle("Trigger on", isOn: $trigger.enabled)
                .labelsHidden()
                .toggleStyle(.switch)
                .controlSize(.mini)
                .tint(SettingsDesign.toggleTint)
                .help(trigger.enabled ? "On" : "Off")
                .accessibilityIdentifier("flow-trigger-enabled")

            Menu {
                Button("Rename…") {
                    newName = trigger.hasCustomName ? trigger.name : ""
                    isRenaming = true
                }
                Button("Edit inputs…") { showsInputs = true }
                Divider()
                Button("Remove trigger", role: .destructive, action: onRemove)
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(AppTheme.secondaryText)
                    .frame(width: 26, height: 26)
                    .contentShape(Rectangle())
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .accessibilityLabel("Options for this trigger")
        }
    }

    // MARK: Main fields

    private var hasMainFields: Bool {
        trigger.source.type != "manual"
    }

    @ViewBuilder
    private var mainFields: some View {
        VStack(alignment: .leading, spacing: 10) {
            switch trigger.source.type {
            case "home.action":
                caption("Adds a button to Home’s Actions. Its Home location stays selected until you change or remove this trigger.")
            case "dashboard.refresh":
                caption("Needs a card on Home. Choose automatic updates or refresh-only in its Home location below. Turning this trigger off pauses card updates.")
            case "schedule":
                row("Schedule") {
                    TextField("0 9 * * 1-5", text: text($trigger.source.cron, fallback: "0 9 * * 1-5"))
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 12, design: .monospaced))
                        .frame(width: 130)
                        .accessibilityLabel("Cron schedule")
                    Text(FlowTriggerSpec.scheduleSummary(cron: trigger.source.cron ?? "") == nil
                        ? "Minute, hour, day, month, weekday"
                        : "Cron")
                        .font(.system(size: 12))
                        .foregroundStyle(AppTheme.tertiaryText)
                }
            case "macos.userReturned":
                row("Away for") {
                    Stepper(
                        "\(FlowTriggerSpec.duration(seconds: trigger.source.minimumIdleSeconds ?? 1800)) or more",
                        value: integer($trigger.source.minimumIdleSeconds, fallback: 1800),
                        in: 60...604_800,
                        step: 300
                    )
                    .font(.system(size: 12))
                }
            case "macos.fileChanges":
                folderFields
            default:
                EmptyView()
            }
            if trigger.isEventDriven {
                Toggle("Notify me when it finishes", isOn: $trigger.notifyOnCompletion)
                    .toggleStyle(.checkbox)
                    .font(.system(size: 12))
                    .padding(.leading, trigger.source.type == "macos.didWake" ? 0 : 102)
            }
        }
    }

    @ViewBuilder
    private var folderFields: some View {
        row("Folder") {
            let folder = trigger.source.folder ?? ""
            if folder.isEmpty {
                Text("No folder chosen")
                    .font(.system(size: 12))
                    .foregroundStyle(AppTheme.tertiaryText)
            } else {
                Label(URL(fileURLWithPath: folder).lastPathComponent, systemImage: "folder")
                    .font(.system(size: 12))
                    .lineLimit(1)
                    .padding(.horizontal, 8)
                    .frame(height: 22)
                    .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(AppTheme.primaryText.opacity(0.06)))
                    .help(folder)
                    .accessibilityLabel("Folder: \(folder)")
            }
            Button("Choose…", action: chooseFolder)
                .controlSize(.small)
        }
        row("Files that are") {
            HStack(spacing: 6) {
                ForEach(["new", "changed", "deleted"], id: \.self) { kind in
                    FlowTriggerChip(label: kind.capitalized, isOn: trigger.source.kinds?.contains(kind) ?? false) {
                        var kinds = Set(trigger.source.kinds ?? [])
                        if kinds.contains(kind) { kinds.remove(kind) } else { kinds.insert(kind) }
                        trigger.source.kinds = ["new", "changed", "deleted"].filter(kinds.contains)
                    }
                }
            }
        }
        row("Types") {
            FlowExtensionField(extensions: Binding(
                get: { trigger.source.extensions ?? [] },
                set: { trigger.source.extensions = $0 }
            ))
        }
        row("Run", alignment: .top) {
            VStack(alignment: .leading, spacing: 5) {
                Picker("Run", selection: Binding(
                    get: { trigger.source.runPerFile ?? false },
                    set: { trigger.source.runPerFile = $0 }
                )) {
                    Text("Once per file").tag(true)
                    Text("Once per batch").tag(false)
                }
                .labelsHidden()
                .pickerStyle(.segmented)
                .fixedSize()
                Text(trigger.source.runPerFile == true
                    ? "Each file gets its own run."
                    : "Files that change together are handled in one run.")
                    .font(.system(size: 11))
                    .foregroundStyle(SettingsDesign.rowDescription)
            }
        }
    }

    // MARK: Limits

    private var limitsHeader: some View {
        Button {
            withAnimation(.easeOut(duration: 0.2)) { showsLimits.toggle() }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "chevron.right")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(AppTheme.secondaryText)
                    .rotationEffect(.degrees(showsLimits ? 90 : 0))
                Text("Limits and timing")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(SettingsDesign.rowTitle)
                Spacer(minLength: 12)
                if !showsLimits, let summary = trigger.limitsSummary {
                    Text(summary)
                        .font(.system(size: 12))
                        .foregroundStyle(SettingsDesign.rowDescription)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 16)
            .frame(height: 38)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(trigger.limitsSummary ?? "")
        .accessibilityIdentifier("flow-trigger-limits")
    }

    private var limitsFields: some View {
        VStack(alignment: .leading, spacing: 10) {
            row("Days") {
                HStack(spacing: 4) {
                    ForEach(0..<7, id: \.self) { day in
                        FlowTriggerChip(
                            label: FlowTriggerSpec.weekdayNames[day],
                            isOn: trigger.conditions.weekdays?.contains(day) ?? false,
                            compact: true
                        ) {
                            var days = Set(trigger.conditions.weekdays ?? [])
                            if days.contains(day) { days.remove(day) } else { days.insert(day) }
                            trigger.conditions.weekdays = days.isEmpty ? nil : days.sorted()
                        }
                    }
                }
            }
            row("Hours") {
                Picker("Hours", selection: Binding(
                    get: { trigger.conditions.timeWindow != nil },
                    set: { trigger.conditions.timeWindow = $0 ? .init(start: "08:00", end: "12:00") : nil }
                )) {
                    Text("Any time").tag(false)
                    Text("Between…").tag(true)
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .fixedSize()
                if trigger.conditions.timeWindow != nil {
                    DatePicker("Start", selection: timeBinding(\.start), displayedComponents: .hourAndMinute)
                        .labelsHidden()
                    Text("and")
                        .font(.system(size: 12))
                        .foregroundStyle(AppTheme.tertiaryText)
                    DatePicker("End", selection: timeBinding(\.end), displayedComponents: .hourAndMinute)
                        .labelsHidden()
                }
            }
            row("Time zone") {
                TextField("Time zone", text: $trigger.conditions.timezone)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 180)
                    .accessibilityLabel("Time zone")
                if let name = TimeZone(identifier: trigger.conditions.timezone)?.localizedName(for: .generic, locale: .current) {
                    Text(name)
                        .font(.system(size: 12))
                        .foregroundStyle(AppTheme.tertiaryText)
                        .lineLimit(1)
                }
            }
            row("How often") {
                Picker("How often", selection: $trigger.frequency) {
                    Text("Every time").tag(FlowTriggerSpec.Frequency.everyTime)
                    Text("At most once a day").tag(FlowTriggerSpec.Frequency.oncePerDay)
                    Text("With a wait between runs").tag(FlowTriggerSpec.Frequency.spaced)
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .fixedSize()
                if trigger.frequency == .spaced {
                    Stepper(
                        FlowTriggerSpec.duration(seconds: trigger.policy.cooldownSeconds),
                        value: Binding(
                            get: { max(1, trigger.policy.cooldownSeconds / 60) },
                            set: { trigger.policy.cooldownSeconds = $0 * 60 }
                        ),
                        in: 1...10_080,
                        step: 5
                    )
                    .font(.system(size: 12))
                }
            }
            if trigger.source.type == "schedule" {
                row("If missed") {
                    Picker("If missed", selection: text($trigger.source.missedRuns, fallback: "latest")) {
                        Text("Run the latest missed time").tag("latest")
                        Text("Skip it").tag("skip")
                    }
                    .labelsHidden()
                    .pickerStyle(.menu)
                    .fixedSize()
                }
            }
            if trigger.source.type == "macos.fileChanges" {
                row("Wait for quiet") {
                    Stepper(
                        "\(trigger.source.settlingSeconds ?? 5) sec after the last change",
                        value: integer($trigger.source.settlingSeconds, fallback: 5),
                        in: 2...60
                    )
                    .font(.system(size: 12))
                }
                row("Skip paths") {
                    TextField("Separate with commas", text: list($trigger.source.excludedPaths))
                        .textFieldStyle(.roundedBorder)
                        .accessibilityLabel("Skip paths")
                }
                VStack(alignment: .leading, spacing: 6) {
                    Toggle("Include subfolders", isOn: Binding(
                        get: { trigger.source.recursive ?? false },
                        set: { trigger.source.recursive = $0 }
                    ))
                    Toggle("Allow folders with over 10,000 files", isOn: Binding(
                        get: { trigger.source.allowLargeFolder ?? false },
                        set: { trigger.source.allowLargeFolder = $0 }
                    ))
                    .help("Large folders cost more to scan. Skip this flow’s output folder to avoid repeat runs.")
                }
                .toggleStyle(.checkbox)
                .font(.system(size: 12))
                .padding(.leading, 102)
            }
        }
    }

    // MARK: Pieces

    private func row<Content: View>(
        _ label: String,
        alignment: VerticalAlignment = .center,
        @ViewBuilder content: () -> Content
    ) -> some View {
        HStack(alignment: alignment, spacing: 10) {
            Text(label)
                .font(.system(size: 12))
                .foregroundStyle(SettingsDesign.rowTitle)
                .frame(width: 92, alignment: .leading)
                .padding(.top, alignment == .top ? 4 : 0)
            HStack(spacing: 8) {
                content()
            }
            Spacer(minLength: 0)
        }
    }

    private func caption(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 12))
            .foregroundStyle(SettingsDesign.rowDescription)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.begin { response in
            if response == .OK {
                trigger.source.folder = panel.url?.path
                trigger.source.allowLargeFolder = false
            }
        }
    }

    private func validation(_ field: String) -> (Bool) -> Void {
        { valid in
            let key = trigger.id + ":" + field
            if valid { invalidFields.remove(key) } else { invalidFields.insert(key) }
        }
    }

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    private func timeBinding(_ keyPath: WritableKeyPath<FlowTriggerSpec.Conditions.Window, String>) -> Binding<Date> {
        Binding(
            get: {
                let value = trigger.conditions.timeWindow?[keyPath: keyPath] ?? "08:00"
                return Self.timeFormatter.date(from: value) ?? Date()
            },
            set: { trigger.conditions.timeWindow?[keyPath: keyPath] = Self.timeFormatter.string(from: $0) }
        )
    }

    private func text(_ value: Binding<String?>, fallback: String = "") -> Binding<String> {
        Binding(get: { value.wrappedValue ?? fallback }, set: { value.wrappedValue = $0 })
    }

    private func integer(_ value: Binding<Int?>, fallback: Int) -> Binding<Int> {
        Binding(get: { value.wrappedValue ?? fallback }, set: { value.wrappedValue = $0 })
    }

    private func list(_ value: Binding<[String]?>) -> Binding<String> {
        Binding(
            get: { (value.wrappedValue ?? []).joined(separator: ", ") },
            set: { value.wrappedValue = $0.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) } }
        )
    }
}

/// A toggle chip for file kinds and weekdays.
private struct FlowTriggerChip: View {
    let label: String
    let isOn: Bool
    var compact = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if isOn, !compact {
                    Image(systemName: "checkmark")
                        .font(.system(size: 8, weight: .heavy))
                }
                Text(label)
                    .font(.system(size: compact ? 11 : 12, weight: isOn ? .semibold : .regular))
            }
            .foregroundStyle(isOn ? AppTheme.accent : SettingsDesign.rowDescription)
            .padding(.horizontal, compact ? 0 : 10)
            .frame(minWidth: compact ? 36 : nil)
            .frame(height: 24)
            .background(
                RoundedRectangle(cornerRadius: compact ? 6 : 12, style: .continuous)
                    .fill(isOn ? AppTheme.accent.opacity(0.12) : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: compact ? 6 : 12, style: .continuous)
                    .strokeBorder(isOn ? AppTheme.accent.opacity(0.45) : SettingsDesign.controlBorder, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

/// File extensions as removable tokens, plus a field to add more.
private struct FlowExtensionField: View {
    @Binding var extensions: [String]
    @State private var entry = ""

    var body: some View {
        HStack(spacing: 5) {
            ForEach(extensions, id: \.self) { ext in
                HStack(spacing: 3) {
                    Text(ext)
                        .font(.system(size: 12))
                    Button {
                        extensions.removeAll { $0 == ext }
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 7, weight: .bold))
                            .foregroundStyle(AppTheme.tertiaryText)
                            .frame(width: 12, height: 12)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove \(ext)")
                }
                .padding(.leading, 7)
                .padding(.trailing, 3)
                .frame(height: 18)
                .background(RoundedRectangle(cornerRadius: 4, style: .continuous).fill(AppTheme.primaryText.opacity(0.07)))
            }
            TextField(extensions.isEmpty ? "Any type. Add one, like png" : "Add a type", text: $entry)
                .textFieldStyle(.plain)
                .font(.system(size: 12))
                .frame(minWidth: 90)
                .onSubmit(commit)
                .onChange(of: entry) { _, value in
                    if value.contains(",") || value.contains(" ") { commit() }
                }
                .accessibilityLabel("Add a file type")
        }
        .padding(.horizontal, 5)
        .frame(minHeight: 26)
        .frame(maxWidth: 320, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(SettingsDesign.cardBackground))
        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(SettingsDesign.controlBorder, lineWidth: 1))
    }

    private func commit() {
        let added = entry
            .split(whereSeparator: { $0 == "," || $0 == " " })
            .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: ". ")).lowercased() }
            .filter { !$0.isEmpty }
        for ext in added where !extensions.contains(ext) {
            extensions.append(ext)
        }
        entry = ""
    }
}

/// The trigger's raw inputs and event mappings, for people who need them.
private struct FlowTriggerInputsSheet: View {
    @Binding var trigger: FlowTriggerSpec
    let validation: (String) -> (Bool) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Trigger inputs")
                .font(.headline)
            Text("Initial values and event mappings are JSON objects. Event fields reach steps as trigger.event.")
                .font(.system(size: 12))
                .foregroundStyle(SettingsDesign.rowDescription)
                .fixedSize(horizontal: false, vertical: true)
            TriggerJSONField(
                title: "Initial inputs",
                validation: validation("inputs"),
                value: Binding(get: { trigger.inputs.mapValues(\.value) }, set: { trigger.inputs = $0.mapValues(AnyCodable.init) })
            )
            TriggerJSONField(
                title: "Event input mappings",
                stringsOnly: true,
                validation: validation("mappings"),
                value: Binding(
                    get: { trigger.eventInputMappings },
                    set: { if let mappings = $0 as? [String: String] { trigger.eventInputMappings = mappings } }
                )
            )
            HStack {
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .textFieldStyle(.roundedBorder)
        .padding(20)
        .frame(width: 460)
    }
}

private struct TriggerJSONField: View {
    let title: String
    var stringsOnly = false
    let validation: (Bool) -> Void
    @Binding var value: [String: Any]
    @State private var text = ""
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 12, weight: .semibold))
            TextField(title, text: $text, axis: .vertical)
                .font(.system(.caption, design: .monospaced))
                .lineLimit(2...8)
                .onAppear {
                    if let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]) {
                        text = String(decoding: data, as: UTF8.self)
                    }
                }
                .onChange(of: text) { _, newValue in
                    if let data = newValue.data(using: .utf8),
                        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                        !stringsOnly || object.values.allSatisfy({ $0 is String })
                    {
                        value = object
                        error = nil
                        validation(true)
                    } else {
                        error = stringsOnly
                            ? "Enter a JSON object whose values are field paths (strings)."
                            : "Enter a valid JSON object before saving."
                        validation(false)
                    }
                }
            if let error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
    }
}
