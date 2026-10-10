import CoreServices
import Foundation

private final class FolderEventContext: @unchecked Sendable {
  weak var watcher: NativeFolderWatcher?
  init(_ watcher: NativeFolderWatcher) { self.watcher = watcher }
}

/// FSEvents invalidates a snapshot; a bounded off-main scan reconciles it after
/// a quiet window. Failed scans reset the baseline without emitting deletions.
@MainActor final class NativeFolderWatcher {
  let watch: NativeFolderWatch
  private var stream: FSEventStreamRef?
  private var task: Task<Void, Never>?
  private var rootIdentity: String?
  private var baseline: [String: NativeFileStamp]?
  private var generation = 0
  private var stopped = false
  private var lastInvalidation = ProcessInfo.processInfo.systemUptime
  private var scanAgain = false
  var onChanges: ([NativeFileChange]) -> Void
  var onStatus: (String?) -> Void
  init(
    watch: NativeFolderWatch, onChanges: @escaping ([NativeFileChange]) -> Void,
    onStatus: @escaping (String?) -> Void
  ) {
    self.watch = watch
    self.onChanges = onChanges
    self.onStatus = onStatus
  }
  func start() {
    let box = FolderEventContext(self)
    var context = FSEventStreamContext(
      version: 0, info: Unmanaged.passUnretained(box).toOpaque(),
      retain: { pointer in
        guard let pointer else { return nil }
        _ = Unmanaged<FolderEventContext>.fromOpaque(pointer).retain()
        return pointer
      },
      release: { pointer in
        if let pointer { Unmanaged<FolderEventContext>.fromOpaque(pointer).release() }
      }, copyDescription: nil)
    let callback: FSEventStreamCallback = { _, context, _, _, _, _ in
      guard let context else { return }
      let box = Unmanaged<FolderEventContext>.fromOpaque(context).takeUnretainedValue()
      MainActor.assumeIsolated { box.watcher?.invalidate() }
    }
    stream = FSEventStreamCreate(
      nil, callback, &context, [watch.root.path] as CFArray,
      FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 0.5,
      FSEventStreamCreateFlags(
        kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagWatchRoot
          | kFSEventStreamCreateFlagNoDefer))
    guard let stream else {
      onStatus("Could not observe folder")
      return
    }
    FSEventStreamSetDispatchQueue(stream, .main)
    guard FSEventStreamStart(stream) else {
      stop()
      onStatus("Could not observe folder")
      return
    }
    schedule(initial: true)
  }
  func stop() {
    stopped = true
    generation += 1
    task?.cancel()
    task = nil
    if let stream {
      FSEventStreamStop(stream)
      FSEventStreamInvalidate(stream)
      FSEventStreamRelease(stream)
    }
    stream = nil
  }
  func invalidate() {
    guard !stopped else { return }
    lastInvalidation = ProcessInfo.processInfo.systemUptime
    if task != nil { scanAgain = true } else { schedule(initial: baseline == nil) }
  }
  private func schedule(initial: Bool) {
    let token = generation
    task = Task { [weak self] in
      guard let self else { return }
      if !initial {
        while ProcessInfo.processInfo.systemUptime - lastInvalidation
          < Double(watch.settlingSeconds)
        {
          do { try await Task.sleep(for: .seconds(1)) } catch { return }
        }
      }
      let watch = self.watch
      let scanner = Task.detached(priority: .utility) {
        try await NativeFolderScanService.shared.scan(watch)
      }
      do {
        let result = try await withTaskCancellationHandler {
          try await scanner.value
        } onCancel: {
          scanner.cancel()
        }
        guard !Task.isCancelled, !stopped, token == generation else { return }
        guard !result.limited else {
          throw NSError(
            domain: "TobyFolderWatch", code: 1,
            userInfo: [
              NSLocalizedDescriptionKey:
                "Folder scan exceeded 100,000 entries or 10 seconds. Narrow the folder or filters."
            ])
        }
        guard result.files.count < 10_000 || watch.allowLargeFolder else {
          throw NSError(
            domain: "TobyFolderWatch", code: 2,
            userInfo: [
              NSLocalizedDescriptionKey:
                "Folder contains at least 10,000 matching files. Review the large-folder warning in Edit."
            ])
        }
        if let previousRoot = rootIdentity, previousRoot != result.rootIdentity { baseline = nil }
        rootIdentity = result.rootIdentity
        if let baseline {
          let changes = NativeFolderScanner.changes(from: baseline, to: result.files, watch: watch)
          // A later event during a scan invalidates its view: settle and scan again.
          if !scanAgain {
            for start in stride(from: 0, to: changes.count, by: 500) {
              onChanges(Array(changes[start..<min(start + 500, changes.count)]))
            }
            self.baseline = result.files
          }
        } else {
          baseline = result.files
        }
        onStatus(nil)
      } catch {
        if !Task.isCancelled, token == generation {
          onStatus(error.localizedDescription)
          baseline = nil
          if (error as NSError).domain == "TobyFolderWatch" {
            stop()
            return
          }
        }
      }
      guard !stopped, token == generation else { return }
      task = nil
      if scanAgain {
        scanAgain = false
        schedule(initial: false)
      }
    }
  }
}
