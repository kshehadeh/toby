import Foundation

/// Plain-language descriptions of a trigger for the editor's trigger card.
extension FlowTriggerSpec {
    enum Frequency: String, CaseIterable {
        case everyTime
        case oncePerDay
        case spaced
    }

    static let weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    /// Triggers that fire on their own and can take days, hours and limits.
    var isEventDriven: Bool { !isUserInvoked && !isHomeRefresh }

    /// "New .png files in Downloads, one run each".
    var plainSummary: String {
        switch source.type {
        case "manual": return "When you run it"
        case "home.action": return "From a button in Home’s Actions"
        case "dashboard.refresh": return "When Home refreshes"
        case "schedule":
            let cron = source.cron ?? ""
            return Self.scheduleSummary(cron: cron) ?? "On a schedule: \(cron)"
        case "macos.didWake": return "When the Mac wakes"
        case "macos.userReturned":
            return "When you’re back after \(Self.duration(seconds: source.minimumIdleSeconds ?? 1800)) away"
        case "macos.fileChanges": return fileSummary
        default: return label
        }
    }

    private var fileSummary: String {
        let kinds = Set(source.kinds ?? [])
        let words = ["new", "changed", "deleted"].filter(kinds.contains)
        let kind = words.isEmpty || words.count == 3 ? "" : words.joined(separator: " or ")
        let extensions = (source.extensions ?? [])
            .map { $0.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: ".")) }
            .filter { !$0.isEmpty }
            .map { "." + $0.lowercased() }
        let types: String
        switch extensions.count {
        case 0: types = "files"
        case 1, 2: types = extensions.joined(separator: " and ") + " files"
        default: types = extensions.prefix(2).joined(separator: ", ") + " and \(extensions.count - 2) more"
        }
        let folder = (source.folder ?? "").trimmingCharacters(in: .whitespaces)
        let place = folder.isEmpty ? "a folder" : URL(fileURLWithPath: folder).lastPathComponent
        let subject = kind.isEmpty ? types : "\(kind) \(types)"
        let sentence = subject.prefix(1).uppercased() + String(subject.dropFirst()) + " in \(place)"
        return source.runPerFile == true ? sentence + ", one run each" : sentence
    }

    /// Common cron shapes in words: "Weekdays at 9:00 AM". Nil for anything else.
    static func scheduleSummary(cron: String) -> String? {
        let fields = cron.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
        guard fields.count == 5, fields[2] == "*", fields[3] == "*", let minute = Int(fields[0]), (0...59).contains(minute) else {
            return nil
        }
        if fields[1] == "*", fields[4] == "*" {
            return String(format: "Every hour at :%02d", minute)
        }
        guard let hour = Int(fields[1]), (0...23).contains(hour) else { return nil }
        let time = clockTime(hour: hour, minute: minute)
        switch fields[4] {
        case "*": return "Every day at \(time)"
        case "1-5": return "Weekdays at \(time)"
        case "0,6", "6,0": return "Weekends at \(time)"
        default:
            guard let day = Int(fields[4]), (0...7).contains(day) else { return nil }
            let names = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"]
            return "\(names[day]) at \(time)"
        }
    }

    /// "Weekdays, any time · once a day · waits 5 sec for quiet". Nil for
    /// triggers that you start yourself.
    var limitsSummary: String? {
        guard isEventDriven else { return nil }
        var parts = ["\(daysSummary), \(hoursSummary)"]
        switch frequency {
        case .everyTime: break
        case .oncePerDay: parts.append("once a day")
        case .spaced: parts.append("at most every \(Self.duration(seconds: policy.cooldownSeconds))")
        }
        if source.type == "macos.fileChanges" {
            parts.append("waits \(source.settlingSeconds ?? 5) sec for quiet")
        }
        return parts.joined(separator: " · ")
    }

    var daysSummary: String {
        let days = Set(conditions.weekdays ?? [])
        if days.isEmpty || days.count == 7 { return "Any day" }
        if days == [1, 2, 3, 4, 5] { return "Weekdays" }
        if days == [0, 6] { return "Weekends" }
        return days.sorted().compactMap { Self.weekdayNames.indices.contains($0) ? Self.weekdayNames[$0] : nil }
            .joined(separator: ", ")
    }

    var hoursSummary: String {
        guard let window = conditions.timeWindow else { return "any time" }
        return "\(window.start) to \(window.end)"
    }

    /// Every time / at most once a day / with a wait between runs.
    var frequency: Frequency {
        get {
            if policy.oncePerDay { return .oncePerDay }
            return policy.cooldownSeconds > 0 ? .spaced : .everyTime
        }
        set {
            switch newValue {
            case .everyTime: policy = Policy(cooldownSeconds: 0, oncePerDay: false)
            case .oncePerDay: policy = Policy(cooldownSeconds: 0, oncePerDay: true)
            case .spaced: policy = Policy(cooldownSeconds: max(policy.cooldownSeconds, 300), oncePerDay: false)
            }
        }
    }

    /// True when someone named the trigger themselves.
    var hasCustomName: Bool {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        // Names the app and the daemon give new triggers, plus the descriptions.
        let defaults: Set<String> = [
            "", "Manually", "New trigger", "Home Screen Action", "Home refresh",
            "Return after idle", "Mac wakes", "Files in a folder", label, plainSummary,
        ]
        return !defaults.contains(trimmed)
    }

    /// Keeps an unnamed trigger's name in step with what it does, so run
    /// history says "New .png files in Downloads" instead of "New trigger".
    mutating func syncDefaultName(from previous: FlowTriggerSpec) {
        guard name == previous.name, !previous.hasCustomName else { return }
        let synced: String
        switch source.type {
        case "manual": synced = "Manually"
        case "home.action": synced = "Home Screen Action"
        case "dashboard.refresh": synced = "Home refresh"
        default: synced = plainSummary
        }
        name = String(synced.prefix(200))
    }

    static func duration(seconds: Int) -> String {
        if seconds < 60 { return "\(seconds) sec" }
        if seconds < 3600 { return "\(seconds / 60) min" }
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        return minutes == 0 ? "\(hours) hr" : "\(hours) hr \(minutes) min"
    }

    private static func clockTime(hour: Int, minute: Int) -> String {
        let twelve = hour % 12 == 0 ? 12 : hour % 12
        return "\(twelve):" + String(format: "%02d", minute) + (hour < 12 ? " AM" : " PM")
    }
}
