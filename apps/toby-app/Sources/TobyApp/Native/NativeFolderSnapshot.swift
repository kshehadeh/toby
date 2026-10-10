import Foundation

struct NativeFolderWatch: Codable, Equatable, Sendable {
  let id: String
  let folder: String
  let recursive: Bool
  let extensions: [String]
  let excludedPaths: [String]
  let kinds: [String]
  let settlingSeconds: Int
  let allowLargeFolder: Bool
  var assessmentKey: String {
    "\(folder)|\(recursive)|\(extensions.sorted())|\(excludedPaths.sorted())"
  }
  var root: URL { URL(fileURLWithPath: folder).standardizedFileURL }
  func includes(_ url: URL) -> Bool {
    let path = url.standardizedFileURL.path
    if excludedPaths.contains(where: { exclusion in
      let excluded =
        exclusion.hasPrefix("/")
        ? URL(fileURLWithPath: exclusion).standardizedFileURL.path
        : root.appendingPathComponent(exclusion).standardizedFileURL.path
      return path == excluded || path.hasPrefix(excluded + "/")
    }) {
      return false
    }
    return extensions.isEmpty
      || extensions.map { $0.lowercased() }.contains(url.pathExtension.lowercased())
  }
}
struct NativeFileStamp: Equatable, Sendable {
  let size: Int
  let modifiedAt: Date
  let identity: String
}
struct NativeFileChange: Codable, Equatable, Sendable {
  let kind: String
  let path: String
  let relativePath: String
  let size: Int
  let modifiedAt: String
}
struct NativeFolderScan: Sendable {
  let files: [String: NativeFileStamp]
  let visited: Int
  let limited: Bool
  let rootIdentity: String
}
enum NativeFolderScanner {
  nonisolated static func scan(
    _ watch: NativeFolderWatch, assessment: Bool = false, maximumEntries: Int = 100_000,
    assessmentLimit: Int = 10_000
  ) throws
    -> NativeFolderScan
  {
    let fm = FileManager.default
    let root = watch.root
    let values = try root.resourceValues(forKeys: [
      .isDirectoryKey, .isSymbolicLinkKey, .fileResourceIdentifierKey, .volumeIdentifierKey,
    ])
    guard values.isDirectory == true, values.isSymbolicLink != true,
      fm.isReadableFile(atPath: root.path)
    else {
      throw CocoaError(.fileReadNoPermission)
    }
    let keys: Set<URLResourceKey> = [
      .isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey,
      .contentModificationDateKey, .fileResourceIdentifierKey,
    ]
    var scanError: Error?
    guard
      let enumerator = fm.enumerator(
        at: root, includingPropertiesForKeys: Array(keys),
        options: [.skipsHiddenFiles, .skipsPackageDescendants],
        errorHandler: { _, error in
          scanError = error
          return false
        })
    else { throw CocoaError(.fileReadUnknown) }
    let rootIdentity =
      "\(String(describing: values.fileResourceIdentifier))|\(String(describing: values.volumeIdentifier))"
    var files: [String: NativeFileStamp] = [:]
    var visited = 0
    let started = ProcessInfo.processInfo.systemUptime
    for case let url as URL in enumerator {
      try Task.checkCancellation()
      visited += 1
      if visited > maximumEntries || ProcessInfo.processInfo.systemUptime - started > 10
        || (assessment && files.count >= assessmentLimit)
      {
        return NativeFolderScan(
          files: files, visited: visited, limited: true, rootIdentity: rootIdentity)
      }
      let v = try url.resourceValues(forKeys: keys)
      if v.isSymbolicLink == true {
        enumerator.skipDescendants()
        continue
      }
      if v.isDirectory == true {
        if !watch.recursive || !watch.includesDirectory(url) { enumerator.skipDescendants() }
        continue
      }
      guard v.isRegularFile == true, watch.includes(url), let size = v.fileSize,
        let modified = v.contentModificationDate
      else { continue }
      files[url.standardizedFileURL.path] = NativeFileStamp(
        size: size, modifiedAt: modified, identity: String(describing: v.fileResourceIdentifier))
    }
    if let scanError { throw scanError }
    // Recheck the root: disappearance/access loss is not a mass deletion.
    guard fm.isReadableFile(atPath: root.path),
      try root.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true
    else { throw CocoaError(.fileReadNoSuchFile) }
    return NativeFolderScan(
      files: files, visited: visited, limited: false, rootIdentity: rootIdentity)
  }
  nonisolated static func changes(
    from old: [String: NativeFileStamp], to new: [String: NativeFileStamp], watch: NativeFolderWatch
  ) -> [NativeFileChange] {
    Set(old.keys).union(new.keys).sorted().compactMap { path in
      let kind: String
      let stamp: NativeFileStamp
      if let current = new[path] {
        if let prior = old[path] {
          if prior == current { return nil }
          kind = "changed"
        } else {
          kind = "new"
        }
        stamp = current
      } else if let prior = old[path] {
        kind = "deleted"
        stamp = prior
      } else {
        return nil
      }
      guard watch.kinds.contains(kind) else { return nil }
      return NativeFileChange(
        kind: kind, path: path,
        relativePath: String(
          path.dropFirst(watch.root.path == "/" ? 1 : watch.root.path.count + 1)),
        size: stamp.size, modifiedAt: ISO8601DateFormatter().string(from: stamp.modifiedAt))
    }
  }
}
extension NativeFolderWatch {
  func includesDirectory(_ url: URL) -> Bool {
    let path = url.standardizedFileURL.path
    return !excludedPaths.contains { value in
      let excluded =
        value.hasPrefix("/")
        ? URL(fileURLWithPath: value).standardizedFileURL.path
        : root.appendingPathComponent(value).standardizedFileURL.path
      return path == excluded || path.hasPrefix(excluded + "/")
    }
  }
}

actor NativeFolderScanService {
  static let shared = NativeFolderScanService()
  func scan(_ watch: NativeFolderWatch, assessment: Bool = false) throws -> NativeFolderScan {
    try Task.checkCancellation()
    return try NativeFolderScanner.scan(watch, assessment: assessment)
  }
}
