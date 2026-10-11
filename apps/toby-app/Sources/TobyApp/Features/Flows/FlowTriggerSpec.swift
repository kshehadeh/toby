import Foundation

struct FlowTriggerSpec: Decodable, Equatable, Identifiable {
    struct Source: Codable, Equatable {
        var type: String
        var cron: String?
        var missedRuns: String?
        var minimumIdleSeconds: Int?
        var folder: String?
        var recursive: Bool?
        var extensions: [String]?
        var excludedPaths: [String]?
        var kinds: [String]?
        var settlingSeconds: Int?
        var allowLargeFolder: Bool?
        var runPerFile: Bool?
    }
    struct Conditions: Codable, Equatable {
        struct Window: Codable, Equatable { var start: String; var end: String }
        var timezone: String
        var weekdays: [Int]?
        var timeWindow: Window?
    }
    struct Policy: Codable, Equatable { var cooldownSeconds: Int; var oncePerDay: Bool }
    var id: String
    var name: String
    var enabled: Bool
    var source: Source
    var conditions: Conditions
    var policy: Policy
    private var inputData: Data
    var inputs: [String: AnyCodable] {
        get { (try? JSONDecoder().decode([String: AnyCodable].self, from: inputData)) ?? [:] }
        set { inputData = (try? JSONSerialization.data(withJSONObject: newValue.mapValues(\.value), options: .sortedKeys)) ?? Data("{}".utf8) }
    }
    var eventInputMappings: [String: String]
    var notifyOnCompletion: Bool

    init() {
        id = UUID().uuidString; name = "Manually"; enabled = true; source = Source(type: "manual")
        conditions = Conditions(timezone: TimeZone.current.identifier)
        policy = Policy(cooldownSeconds: 0, oncePerDay: false)
        inputData = Data("{}".utf8); eventInputMappings = [:]; notifyOnCompletion = false
    }
    private enum CodingKeys: String, CodingKey { case id, name, enabled, source, conditions, policy, inputs, eventInputMappings, notifyOnCompletion }
    init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        id = try fields.decode(String.self, forKey: .id)
        name = try fields.decode(String.self, forKey: .name)
        enabled = try fields.decode(Bool.self, forKey: .enabled)
        source = try fields.decode(Source.self, forKey: .source)
        conditions = try fields.decode(Conditions.self, forKey: .conditions)
        policy = try fields.decode(Policy.self, forKey: .policy)
        let values = try fields.decode([String: AnyCodable].self, forKey: .inputs)
        inputData = try JSONSerialization.data(withJSONObject: values.mapValues(\.value), options: .sortedKeys)
        eventInputMappings = try fields.decode([String: String].self, forKey: .eventInputMappings)
        notifyOnCompletion = try fields.decode(Bool.self, forKey: .notifyOnCompletion)
    }
    static func manual() -> Self { Self() }
    static func homeAction() -> Self {
        var trigger = Self()
        trigger.name = "Home Screen Action"
        trigger.changeSource("home.action")
        return trigger
    }
    static func homeRefresh() -> Self {
        var trigger = Self()
        trigger.name = "Home refresh"
        trigger.source = Source(type: "dashboard.refresh")
        return trigger
    }
    var isHomeRefresh: Bool { source.type == "dashboard.refresh" }
    var isUserInvoked: Bool { source.type == "manual" || source.type == "home.action" }
    var label: String {
        switch source.type {
        case "manual": return "Manually"
        case "home.action": return "Home Screen Action"
        case "dashboard.refresh": return "When Home refreshes"
        case "schedule": return "\(source.cron ?? "Schedule") · \(conditions.timezone)"
        case "macos.didWake": return "When the Mac wakes"
        case "macos.userReturned": return "Return after \((source.minimumIdleSeconds ?? 1800) / 60) minutes idle"
        case "macos.fileChanges": return "Files in \(source.folder ?? "folder")"
        default: return source.type
        }
    }
    mutating func changeSource(_ type: String) {
        if name == "Manually" || name == "New trigger" || name == "Home Screen Action" || name == "Home refresh" {
            if type == "home.action" { name = "Home Screen Action" }
            if type == "dashboard.refresh" { name = "Home refresh" }
        }
        switch type {
        case "schedule": source = Source(type: type, cron: "0 9 * * 1-5", missedRuns: "latest")
        case "macos.userReturned": source = Source(type: type, minimumIdleSeconds: 1800)
        case "macos.fileChanges": source = Source(type: type, folder: "", recursive: false, extensions: [], excludedPaths: [], kinds: ["new"], settlingSeconds: 5, allowLargeFolder: false)
        default: source = Source(type: type)
        }
        eventInputMappings = [:]
        enabled = isUserInvoked || isHomeRefresh
    }
    var jsonBody: [String: Any] {
        func object<T: Encodable>(_ value: T) -> Any {
            guard let data = try? JSONEncoder().encode(value), let json = try? JSONSerialization.jsonObject(with: data) else { return [:] }
            return json
        }
        return ["id": id, "name": name, "enabled": enabled, "source": object(source), "conditions": object(conditions),
                "policy": object(policy), "inputs": inputs.mapValues(\.value), "eventInputMappings": eventInputMappings, "notifyOnCompletion": notifyOnCompletion]
    }
}
