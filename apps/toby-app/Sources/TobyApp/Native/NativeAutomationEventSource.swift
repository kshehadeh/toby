import AppKit
import CoreGraphics

/// Uses input timestamps rather than changes in sampled idle duration: a new
/// input can occur even if the next sample has a larger idle duration.
struct NativeIdleEpisode {
  private var previousInput: Date?
  private var observedStart: Date?
  mutating func reset() {
    previousInput = nil
    observedStart = nil
  }
  mutating func sample(idleSeconds: Double?, now: Date) -> Double? {
    guard let idleSeconds, idleSeconds.isFinite, idleSeconds >= 0 else {
      reset()
      return nil
    }
    let input = now.addingTimeInterval(-idleSeconds)
    guard let previousInput, let observedStart else {
      self.previousInput = input
      self.observedStart = now
      return nil
    }
    guard input.timeIntervalSince(previousInput) > 1 else { return nil }
    let duration = max(0, input.timeIntervalSince(observedStart))
    self.previousInput = input
    self.observedStart = input
    return duration >= 10 ? duration : nil
  }
}

struct NativeAutomationPayload: Codable {
  var idleSeconds: Double?
  var watchId: String?
  var folder: String?
  var changes: [NativeFileChange]?
  subscript(_ key: String) -> Double? { key == "idleSeconds" ? idleSeconds : nil }
}

struct NativeAutomationEvent: Codable {
  let version = 1
  let id: String
  let source = "macos"
  let type: String
  let occurredAt: String
  let observationSessionId: String
  let sequence: Int
  let payload: NativeAutomationPayload
}

@MainActor
final class NativeAutomationEventSource: NSObject {
  static let shared = NativeAutomationEventSource()
  private(set) var sessionId = UUID().uuidString.lowercased()
  private(set) var sequence = 0
  private(set) var events: [NativeAutomationEvent] = []
  private var types: Set<String> = []
  private var owner: String?
  private var folderWatchers: [String: NativeFolderWatcher] = [:]
  private var folderErrors: [String: String] = [:]
  private var leaseUntil: Date?
  private var timer: Timer?
  private var idle = NativeIdleEpisode()
  private var isSleeping = false
  private var sessionActive = true
  private(set) var idleAvailable = true
  private var lastObservationAt: Date?
  var now: () -> Date = { Date() }
  var readIdle: () -> Double? = {
    let seconds = CGEventSource.secondsSinceLastEventType(
      .hidSystemState, eventType: .init(rawValue: UInt32.max)!)
    return seconds.isFinite && seconds >= 0 ? seconds : nil
  }

  func reset() {
    for watcher in folderWatchers.values { watcher.stop() }
    folderWatchers = [:]
    folderErrors = [:]
    timer?.invalidate()
    timer = nil
    NSWorkspace.shared.notificationCenter.removeObserver(self)
    types = []
    owner = nil
    leaseUntil = nil
    idle.reset()
    events = []
    sequence = 0
    sessionId = UUID().uuidString.lowercased()
    isSleeping = false
    sessionActive = true
    lastObservationAt = nil
  }

  func subscribe(
    owner newOwner: String, types requested: Set<String>, watches: [NativeFolderWatch] = []
  ) -> [String: Any] {
    if owner != newOwner || types != requested { reset() }
    owner = newOwner
    types = requested
    leaseUntil = now().addingTimeInterval(30)
    configureFolders(watches)
    if !types.isEmpty && timer == nil {
      let center = NSWorkspace.shared.notificationCenter
      for name in [
        NSWorkspace.willSleepNotification, NSWorkspace.didWakeNotification,
        NSWorkspace.sessionDidResignActiveNotification,
        NSWorkspace.sessionDidBecomeActiveNotification,
      ] {
        center.addObserver(self, selector: #selector(workspaceChanged(_:)), name: name, object: nil)
      }
      sample()
      timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
        MainActor.assumeIsolated { self?.sample() }
      }
    }
    return status()
  }

  func status() -> [String: Any] {
    [
      "sessionId": sessionId, "sequence": sequence, "idleAvailable": idleAvailable,
      "observing": !types.isEmpty,
      "folderErrors": folderErrors,
      "lastObservationAt": lastObservationAt.map { ISO8601DateFormatter().string(from: $0) as Any }
        ?? NSNull(),
    ]
  }

  func sample() {
    let date = now()
    if !isSleeping, let leaseUntil, date > leaseUntil {
      reset()
      return
    }
    guard !types.isEmpty, !isSleeping, sessionActive else { return }
    let value = readIdle()
    idleAvailable = value != nil
    lastObservationAt = date
    if let duration = idle.sample(idleSeconds: value, now: date),
      types.contains("macos.userReturned")
    {
      emit("macos.userReturned", payload: .init(idleSeconds: duration))
    }
    prune()
  }

  func didWake() {
    // A sleeping Mac cannot renew its daemon lease. Allow one renewal window
    // after an observed sleep, then expire normally if the daemon stays absent.
    if isSleeping { leaseUntil = now().addingTimeInterval(30) }
    isSleeping = false
    idle.reset()
    if types.contains("macos.didWake") { emit("macos.didWake", payload: .init()) }
  }

  @objc private func workspaceChanged(_ notification: Notification) {
    switch notification.name {
    case NSWorkspace.willSleepNotification:
      isSleeping = true
      idle.reset()
    case NSWorkspace.didWakeNotification: didWake()
    case NSWorkspace.sessionDidResignActiveNotification:
      sessionActive = false
      idle.reset()
    case NSWorkspace.sessionDidBecomeActiveNotification:
      sessionActive = true
      idle.reset()
    default: break
    }
  }

  private func configureFolders(_ requested: [NativeFolderWatch]) {
    let active = types.contains("macos.fileChanges") ? requested : []
    let wanted = Set(active.map(\.id))
    for id in Array(folderWatchers.keys) where !wanted.contains(id) {
      folderWatchers.removeValue(forKey: id)?.stop()
      folderErrors.removeValue(forKey: id)
    }
    for watch in active {
      if folderWatchers[watch.id]?.watch == watch { continue }
      folderWatchers.removeValue(forKey: watch.id)?.stop()
      folderErrors[watch.id] = "Scanning folder baseline"
      let watcher = NativeFolderWatcher(
        watch: watch,
        onChanges: { [weak self] changes in
          guard let self, let leaseUntil, now() <= leaseUntil, !isSleeping else { return }
          emit(
            "macos.fileChanges",
            payload: .init(watchId: watch.id, folder: watch.root.path, changes: changes))
        }, onStatus: { [weak self] error in self?.folderErrors[watch.id] = error })
      folderWatchers[watch.id] = watcher
      watcher.start()
    }
  }
  private func emit(_ type: String, payload: NativeAutomationPayload) {
    sequence += 1
    events.append(
      .init(
        id: "\(sessionId):\(sequence)", type: type,
        occurredAt: ISO8601DateFormatter().string(from: now()), observationSessionId: sessionId,
        sequence: sequence, payload: payload))
    prune()
  }
  private func prune() {
    let cutoff = now().addingTimeInterval(-120)
    events.removeAll { (ISO8601DateFormatter().date(from: $0.occurredAt) ?? .distantPast) < cutoff }
    if events.count > 1024 { events.removeFirst(events.count - 1024) }
  }
  func batch(session: String, after: Int, limit: Int) -> [String: Any] {
    prune()
    let first = events.first?.sequence ?? sequence + 1
    let gap = session != sessionId || after < first - 1 || after > sequence
    let values = gap ? [] : Array(events.filter { $0.sequence > after }.prefix(limit))
    let json = (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(values))) ?? []
    return [
      "events": json, "gap": gap, "sessionId": sessionId,
      "sequence": gap ? sequence : values.last?.sequence ?? after,
    ]
  }

  func handle(method: String, path: String, body: Data?) -> [String: Any] {
    let components = URLComponents(string: "http://localhost" + path)
    let resource = components?.path ?? path
    if resource == "/api/native/automations/status", method == "GET" {
      return ["ok": true, "data": status()]
    }
    if resource == "/api/native/automations/subscriptions", method == "PUT",
      let body, let value = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
      let owner = value["owner"] as? String, UUID(uuidString: owner) != nil,
      let names = value["types"] as? [String],
      names.allSatisfy({
        ["macos.userReturned", "macos.didWake", "macos.fileChanges"].contains($0)
      })
    {
      let rawWatches = value["watches"] ?? []
      guard let data = try? JSONSerialization.data(withJSONObject: rawWatches),
        let watches = try? JSONDecoder().decode([NativeFolderWatch].self, from: data),
        watches.count <= 100,
        watches.allSatisfy({
          $0.folder.hasPrefix("/") && (2...60).contains($0.settlingSeconds) && !$0.kinds.isEmpty
            && $0.kinds.allSatisfy(["new", "changed", "deleted"].contains)
        })
      else { return ["ok": false, "error": "Invalid folder watches"] }
      return ["ok": true, "data": subscribe(owner: owner, types: Set(names), watches: watches)]
    }
    if resource == "/api/native/automations/events", method == "GET" {
      let query = components?.queryItems ?? []
      func item(_ key: String) -> String? { query.first { $0.name == key }?.value }
      if let session = item("sessionId"), let text = item("after"), let after = Int(text),
        after >= 0
      {
        return [
          "ok": true,
          "data": batch(
            session: session, after: after,
            limit: min(100, max(1, Int(item("limit") ?? "100") ?? 100))),
        ]
      }
    }
    return ["ok": false, "error": "Invalid automation request"]
  }
}
