import Foundation

struct AutomationItem: Decodable, Identifiable {
  struct Trigger: Decodable {
    let type: String
    let minimumIdleSeconds: Int?
  }
  struct TimeWindow: Decodable {
    let start: String
    let end: String
  }
  struct Conditions: Decodable {
    let timezone: String
    let weekdays: [Int]?
    let timeWindow: TimeWindow?
  }
  struct Action: Decodable {
    let flowId: String
    let inputs: AnyCodable
    let eventInputMappings: [String: String]
  }
  struct Policy: Decodable {
    let cooldownSeconds: Int
    let oncePerDay: Bool
  }
  let id: String
  let revision: Int
  let name: String
  let enabled: Bool
  let trigger: Trigger
  let conditions: Conditions
  let action: Action
  let policy: Policy
  let notifyOnCompletion: Bool
  var triggerLabel: String {
    trigger.type == "macos.didWake"
      ? "When the Mac wakes"
      : "Return after \((trigger.minimumIdleSeconds ?? 1800) / 60) minutes idle"
  }
}
struct AutomationRunItem: Decodable, Identifiable {
  struct Event: Decodable {
    let type: String
    let occurredAt: String
    let payload: AnyCodable
  }
  let id: String
  let automationId: String
  let definition: AutomationItem
  let event: Event
  let status: String
  let reason: String?
  let flowRunId: String?
  let output: String?
  let createdAt: String
}
struct AutomationSourceState: Decodable {
  let state: String
  let message: String
  let lastPollAt: String?
}

struct AutomationEditorDraft: Identifiable, Equatable {
  var id = UUID().uuidString
  var existingId: String?
  var revision: Int?
  var name = ""
  var enabled = false
  var triggerType = "macos.userReturned"
  private var originalIdleSeconds: Int?
  private var originalCooldownSeconds: Int?
  var idleMinutes = 30
  var timezone = TimeZone.current.identifier
  var weekdays: Set<Int> = []
  var useTimeWindow = false
  var startTime = "08:00"
  var endTime = "12:00"
  var flowId = ""
  var cooldownMinutes = 5
  var oncePerDay = false
  var notifyOnCompletion = true
  var inputsJSON = "{}"
  var mappingsJSON = "{}"
  var canSave: Bool {
    !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !flowId.isEmpty
      && idleMinutes > 0 && cooldownMinutes >= 0
  }
  init(item: AutomationItem? = nil) {
    guard let item else { return }
    existingId = item.id
    revision = item.revision
    name = item.name
    enabled = item.enabled
    triggerType = item.trigger.type
    originalIdleSeconds = item.trigger.minimumIdleSeconds
    idleMinutes = Int(ceil(Double(item.trigger.minimumIdleSeconds ?? 1800) / 60))
    timezone = item.conditions.timezone
    weekdays = Set(item.conditions.weekdays ?? [])
    useTimeWindow = item.conditions.timeWindow != nil
    startTime = item.conditions.timeWindow?.start ?? "08:00"
    endTime = item.conditions.timeWindow?.end ?? "12:00"
    flowId = item.action.flowId
    originalCooldownSeconds = item.policy.cooldownSeconds
    cooldownMinutes = Int(ceil(Double(item.policy.cooldownSeconds) / 60))
    oncePerDay = item.policy.oncePerDay
    notifyOnCompletion = item.notifyOnCompletion
    inputsJSON = item.action.inputs.prettyPrinted(maxLength: 1_000_000)
    if let data = try? JSONSerialization.data(
      withJSONObject: item.action.eventInputMappings, options: [.prettyPrinted, .sortedKeys]),
      let text = String(data: data, encoding: .utf8)
    {
      mappingsJSON = text
    }
  }
  func body() throws -> [String: Any] {
    func object(_ text: String) throws -> [String: Any] {
      guard let data = text.data(using: .utf8),
        let value = try JSONSerialization.jsonObject(with: data) as? [String: Any]
      else { throw TobyClientError.serverError("Inputs and mappings must be JSON objects") }
      return value
    }
    var trigger: [String: Any] = ["type": triggerType]
    if triggerType == "macos.userReturned" {
      trigger["minimumIdleSeconds"] =
        originalIdleSeconds.map {
          Int(ceil(Double($0) / 60)) == idleMinutes ? $0 : idleMinutes * 60
        } ?? idleMinutes * 60
    }
    var conditions: [String: Any] = ["timezone": timezone]
    if !weekdays.isEmpty { conditions["weekdays"] = weekdays.sorted() }
    if useTimeWindow { conditions["timeWindow"] = ["start": startTime, "end": endTime] }
    var body: [String: Any] = [
      "name": name, "enabled": enabled, "trigger": trigger, "conditions": conditions,
      "action": [
        "type": "flow", "flowId": flowId, "inputs": try object(inputsJSON),
        "eventInputMappings": try object(mappingsJSON),
      ],
      "policy": [
        "cooldownSeconds": originalCooldownSeconds.map {
          Int(ceil(Double($0) / 60)) == cooldownMinutes ? $0 : cooldownMinutes * 60
        } ?? cooldownMinutes * 60, "oncePerDay": oncePerDay,
      ], "notifyOnCompletion": notifyOnCompletion,
    ]
    if let revision { body["revision"] = revision }
    return body
  }
}
