import SwiftUI
import AppKit

struct FlowTriggersEditor: View {
    @Binding var triggers: [FlowTriggerSpec]
    @Binding var invalidFields: Set<String>
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("When").font(.headline)
            Text("Choose when this flow runs. Each trigger has its own inputs and limits.")
                .font(.caption).foregroundStyle(.secondary)
            ForEach($triggers) { $trigger in
                FlowTriggerEditor(trigger: $trigger, invalidFields: $invalidFields) {
                    let id = trigger.id
                    invalidFields = invalidFields.filter { !$0.hasPrefix(id + ":") }
                    triggers.removeAll { $0.id == id }
                }
            }
            Button("Add trigger", systemImage: "plus") {
                var trigger = FlowTriggerSpec.manual()
                trigger.name = "New trigger"
                triggers.append(trigger)
            }
        }.accessibilityIdentifier("flow-triggers-editor")
    }
}

private struct FlowTriggerEditor: View {
    @Binding var trigger: FlowTriggerSpec
    @Binding var invalidFields: Set<String>
    let onRemove: () -> Void
    var body: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    TextField("Trigger name", text: $trigger.name)
                    Toggle("Enabled", isOn: $trigger.enabled)
                    Button("Remove trigger", systemImage: "trash", role: .destructive, action: onRemove).labelStyle(.iconOnly)
                }
                Picker("Run", selection: Binding(get: { trigger.source.type }, set: { trigger.changeSource($0) })) {
                    Text("Manually").tag("manual")
                    Text("Home Screen Action").tag("home.action")
                    Text("Home refresh").tag("dashboard.refresh")
                    Text("On a schedule").tag("schedule")
                    Text("When the Mac wakes").tag("macos.didWake")
                    Text("When I return after idle").tag("macos.userReturned")
                    Text("When files change").tag("macos.fileChanges")
                }
                if trigger.source.type == "home.action" {
                    Text("Adds a button to Home’s Actions. Its Home location stays selected until you change or remove this trigger.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if trigger.source.type == "schedule" {
                    TextField("Cron expression", text: text($trigger.source.cron, fallback: "0 9 * * 1-5"))
                    Text("Five fields: minute, hour, day, month, weekday. Example: 0 9 * * 1-5 runs weekdays at 9am.")
                        .font(.caption).foregroundStyle(.secondary)
                    Picker("Missed runs", selection: text($trigger.source.missedRuns, fallback: "latest")) {
                        Text("Run the latest missed occurrence").tag("latest")
                        Text("Skip occurrences more than a minute late").tag("skip")
                    }
                }
                if trigger.source.type == "macos.userReturned" {
                    Stepper("Minimum idle: \(trigger.source.minimumIdleSeconds ?? 1800) seconds", value: integer($trigger.source.minimumIdleSeconds, fallback: 1800), in: 10...604800, step: 60)
                }
                if trigger.source.type == "macos.fileChanges" { folderFields }
                if trigger.isHomeRefresh {
                    Text("Requires a card on Home. Choose automatic updates or refresh only in its Home location below. Disabling this trigger pauses card updates.").font(.caption).foregroundStyle(.secondary)
                }
                if !trigger.isUserInvoked && !trigger.isHomeRefresh {
                    TextField("Timezone", text: $trigger.conditions.timezone)
                    TextField("Cooldown (seconds)", value: $trigger.policy.cooldownSeconds, format: .number)
                    Toggle("At most once per calendar day", isOn: $trigger.policy.oncePerDay)
                    weekdayFields
                    Toggle("Limit to a time window", isOn: Binding(get: { trigger.conditions.timeWindow != nil }, set: { trigger.conditions.timeWindow = $0 ? .init(start: "08:00", end: "12:00") : nil }))
                    if trigger.conditions.timeWindow != nil {
                        HStack {
                            TextField("Start (HH:mm)", text: Binding(get: { trigger.conditions.timeWindow?.start ?? "" }, set: { trigger.conditions.timeWindow?.start = $0 }))
                            TextField("End (HH:mm)", text: Binding(get: { trigger.conditions.timeWindow?.end ?? "" }, set: { trigger.conditions.timeWindow?.end = $0 }))
                        }
                    }
                    Toggle("Notify when finished", isOn: $trigger.notifyOnCompletion)
                }
                if trigger.source.type.hasPrefix("macos.") {
                    Text("Toby.app must stay running to observe this trigger. Events while the app is closed are missed.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                DisclosureGroup("Inputs") {
                    Text("Initial values and event mappings are JSON objects. Event fields are available to steps as trigger.event.").font(.caption).foregroundStyle(.secondary)
                    TriggerJSONField(title: "Initial inputs", validation: validation("inputs"), value: Binding(get: { trigger.inputs.mapValues(\.value) }, set: { trigger.inputs = $0.mapValues(AnyCodable.init) }))
                    TriggerJSONField(title: "Event input mappings", stringsOnly: true, validation: validation("mappings"), value: Binding(get: { trigger.eventInputMappings }, set: { if let mappings = $0 as? [String: String] { trigger.eventInputMappings = mappings } }))
                }
            }.textFieldStyle(.roundedBorder).padding(6)
        }
    }
    private func validation(_ field: String) -> (Bool) -> Void {
        { valid in
            let key = trigger.id + ":" + field
            if valid { invalidFields.remove(key) } else { invalidFields.insert(key) }
        }
    }
    private var weekdayFields: some View {
        VStack(alignment: .leading) {
            Text("Days (none selected means every day)").font(.caption)
            HStack {
                ForEach(0..<7) { day in
                    Toggle(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day], isOn: Binding(get: { trigger.conditions.weekdays?.contains(day) ?? false }, set: { selected in
                        var days = Set(trigger.conditions.weekdays ?? [])
                        if selected { days.insert(day) } else { days.remove(day) }
                        trigger.conditions.weekdays = days.isEmpty ? nil : days.sorted()
                    })).toggleStyle(.button)
                }
            }
        }
    }
    private var folderFields: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                TextField("Folder", text: text($trigger.source.folder))
                Button("Choose…") {
                    let panel = NSOpenPanel()
                    panel.canChooseFiles = false; panel.canChooseDirectories = true
                    panel.begin { response in
                        if response == .OK { trigger.source.folder = panel.url?.path; trigger.source.allowLargeFolder = false }
                    }
                }
            }
            Toggle("Include subfolders", isOn: Binding(get: { trigger.source.recursive ?? false }, set: { trigger.source.recursive = $0 }))
            Toggle("Run once per file", isOn: Binding(get: { trigger.source.runPerFile ?? false }, set: { trigger.source.runPerFile = $0 }))
            Text("Each run receives one file at trigger.event.payload.changes.0.path. Leave off to process a batch together.").font(.caption).foregroundStyle(.secondary)
            TextField("Extensions, separated by commas", text: list($trigger.source.extensions))
            TextField("Excluded paths, separated by commas", text: list($trigger.source.excludedPaths))
            HStack {
                ForEach(["new", "changed", "deleted"], id: \.self) { kind in
                    Toggle(kind.capitalized, isOn: Binding(get: { trigger.source.kinds?.contains(kind) ?? false }, set: { selected in
                        var kinds = Set(trigger.source.kinds ?? [])
                        if selected { kinds.insert(kind) } else { kinds.remove(kind) }
                        trigger.source.kinds = kinds.sorted()
                    }))
                }
            }
            Stepper("Wait for quiet: \(trigger.source.settlingSeconds ?? 5) seconds", value: integer($trigger.source.settlingSeconds, fallback: 5), in: 2...60)
            Toggle("Allow folders with over 10,000 matching files", isOn: Binding(get: { trigger.source.allowLargeFolder ?? false }, set: { trigger.source.allowLargeFolder = $0 }))
            Text("Large folders cost more to scan. Exclude this flow’s output folder to prevent repeated runs.").font(.caption).foregroundStyle(.secondary)
        }
    }
    private func text(_ value: Binding<String?>, fallback: String = "") -> Binding<String> { Binding(get: { value.wrappedValue ?? fallback }, set: { value.wrappedValue = $0 }) }
    private func integer(_ value: Binding<Int?>, fallback: Int) -> Binding<Int> { Binding(get: { value.wrappedValue ?? fallback }, set: { value.wrappedValue = $0 }) }
    private func list(_ value: Binding<[String]?>) -> Binding<String> { Binding(get: { (value.wrappedValue ?? []).joined(separator: ", ") }, set: { value.wrappedValue = $0.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) } }) }
}

private struct TriggerJSONField: View {
    let title: String
    var stringsOnly = false
    let validation: (Bool) -> Void
    @Binding var value: [String: Any]
    @State private var text = ""
    @State private var error: String?
    var body: some View {
        VStack(alignment: .leading) {
            TextField(title, text: $text, axis: .vertical).font(.system(.caption, design: .monospaced)).lineLimit(2...8)
                .onAppear { if let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]) { text = String(decoding: data, as: UTF8.self) } }
                .onChange(of: text) { _, newValue in
                    if let data = newValue.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], !stringsOnly || object.values.allSatisfy({ $0 is String }) { value = object; error = nil; validation(true) }
                    else { error = stringsOnly ? "Enter a JSON object whose values are field paths (strings)." : "Enter a valid JSON object before saving."; validation(false) }
                }
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
        }
    }
}
