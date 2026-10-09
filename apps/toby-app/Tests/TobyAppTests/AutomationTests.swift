import AppKit
import Foundation
import Testing
import ViewInspector

@testable import TobyApp

@Suite("Native event automations") @MainActor
struct AutomationTests {
  @Test("idle startup and repeated samples do not fabricate returns")
  func idleEpisode() {
    var detector = NativeIdleEpisode()
    let start = Date(timeIntervalSince1970: 10_000)
    #expect(detector.sample(idleSeconds: 3600, now: start) == nil)
    #expect(detector.sample(idleSeconds: 3630, now: start.addingTimeInterval(30)) == nil)
    #expect(detector.sample(idleSeconds: 0, now: start.addingTimeInterval(40)) == 40)
    #expect(detector.sample(idleSeconds: 5, now: start.addingTimeInterval(45)) == nil)
    #expect(detector.sample(idleSeconds: 0, now: start.addingTimeInterval(46)) == nil)
  }
  @Test("new input is detected even when sampled idle duration grows")
  func inputBetweenSamples() {
    var detector = NativeIdleEpisode()
    let start = Date(timeIntervalSince1970: 10_000)
    _ = detector.sample(idleSeconds: 0, now: start)
    _ = detector.sample(idleSeconds: 10, now: start.addingTimeInterval(10))
    #expect(detector.sample(idleSeconds: 20, now: start.addingTimeInterval(40)) == 20)
  }
  @Test("invalid readings reset the observation baseline")
  func unavailable() {
    var detector = NativeIdleEpisode()
    let start = Date()
    _ = detector.sample(idleSeconds: 0, now: start)
    #expect(detector.sample(idleSeconds: nil, now: start.addingTimeInterval(30)) == nil)
    #expect(detector.sample(idleSeconds: 0, now: start.addingTimeInterval(60)) == nil)
  }
  @Test("subscriptions deduplicate events, report gaps, and reset on home switch")
  func transport() throws {
    let source = NativeAutomationEventSource()
    var date = Date(timeIntervalSince1970: 10_000)
    var seconds = 0.0
    source.now = { date }
    source.readIdle = { seconds }
    defer { source.reset() }
    let owner = UUID().uuidString
    _ = source.subscribe(owner: owner, types: ["macos.didWake", "macos.userReturned"])
    let session = source.sessionId
    source.didWake()
    source.sample()  // Establish a fresh post-wake baseline.
    let first = source.batch(session: session, after: 0, limit: 100)
    #expect(first["gap"] as? Bool == false)
    #expect(first["sequence"] as? Int == 1)
    #expect(source.batch(session: session, after: 1, limit: 100)["sequence"] as? Int == 1)
    date = date.addingTimeInterval(20)
    seconds = 20
    source.sample()
    date = date.addingTimeInterval(5)
    seconds = 0
    source.sample()
    #expect(source.events.last?.payload["idleSeconds"] == 25)
    #expect(source.sequence == 2)
    _ = source.subscribe(owner: owner, types: ["macos.didWake", "macos.userReturned"])
    #expect(source.sessionId == session)
    source.reset()
    #expect(source.batch(session: session, after: 0, limit: 100)["gap"] as? Bool == true)
  }
  @Test("sleep does not create an idle return and preserves a wake lease")
  func sleepBoundary() {
    let source = NativeAutomationEventSource()
    var date = Date(timeIntervalSince1970: 10_000)
    var seconds = 0.0
    source.now = { date }
    source.readIdle = { seconds }
    defer { source.reset() }
    _ = source.subscribe(owner: UUID().uuidString, types: ["macos.didWake", "macos.userReturned"])
    let session = source.sessionId
    NSWorkspace.shared.notificationCenter.post(name: NSWorkspace.willSleepNotification, object: nil)
    date = date.addingTimeInterval(3600)
    seconds = 3600
    source.sample()
    NSWorkspace.shared.notificationCenter.post(name: NSWorkspace.didWakeNotification, object: nil)
    source.sample()
    date = date.addingTimeInterval(5)
    seconds = 0
    source.sample()
    #expect(source.sessionId == session)
    #expect(source.events.count == 1)
    #expect(source.events.first?.type == "macos.didWake")
  }
  @Test("lease expiry and aged events cannot be replayed")
  func expiration() {
    let source = NativeAutomationEventSource()
    var date = Date(timeIntervalSince1970: 10_000)
    source.now = { date }
    source.readIdle = { 0 }
    defer { source.reset() }
    _ = source.subscribe(owner: UUID().uuidString, types: ["macos.didWake"])
    let session = source.sessionId
    source.didWake()
    date = date.addingTimeInterval(121)
    #expect(source.batch(session: session, after: 0, limit: 100)["gap"] as? Bool == true)
    source.sample()
    #expect(source.sessionId != session)
  }
  @Test("editor validates required fields and preserves draft-only state")
  func editor() throws {
    var draft = AutomationEditorDraft()
    #expect(!draft.canSave)
    draft.name = "Briefing"
    draft.flowId = "flow.test"
    #expect(draft.canSave)
    #expect(!draft.enabled)
    draft.weekdays = [1, 5]
    draft.useTimeWindow = true
    let body = try draft.body()
    let conditions = try #require(body["conditions"] as? [String: Any])
    #expect(conditions["weekdays"] as? [Int] == [1, 5])
    draft.inputsJSON = "[]"
    #expect(throws: (any Error).self) { try draft.body() }
  }
  @Test("editor uses the shared sheet and native enable control")
  func editorView() throws {
    let store = AutomationsStore()
    store.startEditor()
    let sheet = AutomationEditorSheet(store: store)
    #expect(
      try sheet.inspect().find(viewWithAccessibilityIdentifier: "automation-name").textField()
        .input() == "")

  }
}
