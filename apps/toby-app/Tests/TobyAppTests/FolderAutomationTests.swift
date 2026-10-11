import AppKit
import Foundation
import Testing

@testable import TobyApp

@Suite("Folder automations") @MainActor
struct FolderAutomationTests {
  func watch(
    _ root: URL, recursive: Bool = false, excluded: [String] = [],
    kinds: [String] = ["new", "changed", "deleted"]
  ) -> NativeFolderWatch {
    NativeFolderWatch(
      id: "watch", folder: root.path, recursive: recursive, extensions: ["txt"],
      excludedPaths: excluded, kinds: kinds, settlingSeconds: 2, allowLargeFolder: false)
  }
  func temp() throws -> URL {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    return root
  }
  @Test("snapshot filters subfolders, exclusions, hidden files and symlinks")
  func filters() throws {
    let root = try temp()
    defer { try? FileManager.default.removeItem(at: root) }
    try "yes".write(to: root.appendingPathComponent("one.txt"), atomically: true, encoding: .utf8)
    try "no".write(to: root.appendingPathComponent("one.pdf"), atomically: true, encoding: .utf8)
    try "no".write(
      to: root.appendingPathComponent(".hidden.txt"), atomically: true, encoding: .utf8)
    let child = root.appendingPathComponent("output")
    try FileManager.default.createDirectory(at: child, withIntermediateDirectories: true)
    try "child".write(
      to: child.appendingPathComponent("two.txt"), atomically: true, encoding: .utf8)
    try FileManager.default.createSymbolicLink(
      at: root.appendingPathComponent("alias.txt"),
      withDestinationURL: root.appendingPathComponent("one.txt"))
    #expect(try NativeFolderScanner.scan(watch(root)).files.count == 1)
    #expect(try NativeFolderScanner.scan(watch(root, recursive: true)).files.count == 2)
    #expect(
      try NativeFolderScanner.scan(watch(root, recursive: true, excluded: ["output"])).files.count
        == 1)
  }
  @Test("atomic replacement is changed; rename is deletion plus new metadata")
  func reconciliation() throws {
    let root = try temp()
    defer { try? FileManager.default.removeItem(at: root) }
    let file = root.appendingPathComponent("one.txt")
    try "first".write(to: file, atomically: true, encoding: .utf8)
    let w = watch(root)
    let first = try NativeFolderScanner.scan(w)
    try "second version".write(to: file, atomically: true, encoding: .utf8)
    let second = try NativeFolderScanner.scan(w)
    #expect(
      NativeFolderScanner.changes(from: first.files, to: second.files, watch: w).map(\.kind) == [
        "changed"
      ])
    try FileManager.default.moveItem(at: file, to: root.appendingPathComponent("two.txt"))
    let third = try NativeFolderScanner.scan(w)
    let changes = NativeFolderScanner.changes(from: second.files, to: third.files, watch: w)
    #expect(changes.map(\.kind) == ["deleted", "new"])
    #expect(changes.first?.size == "second version".utf8.count)
    try FileManager.default.removeItem(at: root)
    #expect(throws: (any Error).self) { try NativeFolderScanner.scan(w) }
  }
  @Test("assessment and observation scans expose incomplete scans")
  func limits() throws {
    let root = try temp()
    defer { try? FileManager.default.removeItem(at: root) }
    for n in 0..<5 {
      try "x".write(to: root.appendingPathComponent("\(n).txt"), atomically: true, encoding: .utf8)
    }
    #expect(try NativeFolderScanner.scan(watch(root), assessment: true, assessmentLimit: 3).limited)
    #expect(try NativeFolderScanner.scan(watch(root), maximumEntries: 2).limited)
    #expect(try !NativeFolderScanner.scan(watch(root)).limited)
  }
  @Test("real FSEvents emits settled new, changed, and deleted batches without startup replay")
  func liveWatcher() async throws {
    let root = try temp()
    defer { try? FileManager.default.removeItem(at: root) }
    let file = root.appendingPathComponent("one.txt")
    try "existing".write(to: file, atomically: true, encoding: .utf8)
    var ready = false
    var changes: [NativeFileChange] = []
    let observer = NativeFolderWatcher(
      watch: watch(root), onChanges: { changes += $0 }, onStatus: { ready = $0 == nil })
    observer.start()
    defer { observer.stop() }
    try await wait { ready }
    #expect(changes.isEmpty)
    let added = root.appendingPathComponent("two.txt")
    try "new".write(to: added, atomically: true, encoding: .utf8)
    try await wait { changes.contains { $0.kind == "new" } }
    changes = []
    try "updated contents".write(to: added, atomically: true, encoding: .utf8)
    try await wait { changes.contains { $0.kind == "changed" } }
    changes = []
    try FileManager.default.removeItem(at: added)
    try await wait { changes.contains { $0.kind == "deleted" } }
  }
  private func wait(_ predicate: () -> Bool) async throws {
    for _ in 0..<160 {
      if predicate() { return }
      try await Task.sleep(for: .milliseconds(100))
    }
    Issue.record("Folder observation did not finish in time")
  }
  @Test("tool editor round-trips automation references alongside constants")
  func toolReferences() throws {
    let data = Data(
      #"{"id":"inspect","type":"tool_executor","tool":{"userToolId":"tool.test"},"inputs":{"changes":{"from":"trigger","path":"event.payload.changes"},"label":{"const":"Files"}}}"#
        .utf8)
    var node = FlowEditorNode(stored: try JSONDecoder().decode(FlowStoredNode.self, from: data))
    #expect(node.triggerInputs["changes"] == "event.payload.changes")
    node.constInputs["label"] = "Updated"
    let inputs = try #require(node.jsonBody()["inputs"] as? [String: [String: Any]])
    #expect(inputs["changes"]?["from"] as? String == "trigger")
    #expect(inputs["label"]?["const"] as? String == "Updated")
  }
}
