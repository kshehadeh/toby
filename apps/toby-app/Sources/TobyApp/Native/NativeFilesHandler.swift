import Foundation
import UniformTypeIdentifiers

/// File discovery runs in Toby.app so protected-folder access belongs to the app.
enum NativeFilesHandler {
	static func list(body: Data?) async -> Data {
		await Task.detached(priority: .userInitiated) { listSynchronously(body: body) }.value
	}

	private static func json(_ value: [String: Any]) -> Data {
		(try? JSONSerialization.data(withJSONObject: value)) ?? Data(#"{"ok":false,"error":"Could not encode file listing."}"#.utf8)
	}

	private static func listSynchronously(body: Data?) -> Data {
		guard let body, let input = try? JSONSerialization.jsonObject(with: body) as? [String: Any] else {
			return json(["ok": false, "error": "A JSON object is required."])
		}
		let folder = (input["folder"] as? String ?? "downloads").trimmingCharacters(in: .whitespacesAndNewlines)
		let kind = input["kind"] as? String ?? "all"
		let limitValue = input["limit"] as? NSNumber ?? 100
		let offsetValue = input["offset"] as? NSNumber ?? 0
		guard ["all", "images", "files", "folders"].contains(kind),
			CFGetTypeID(limitValue) != CFBooleanGetTypeID(), CFGetTypeID(offsetValue) != CFBooleanGetTypeID(),
			limitValue.doubleValue.rounded() == limitValue.doubleValue, (1...200).contains(limitValue.doubleValue),
			offsetValue.doubleValue.rounded() == offsetValue.doubleValue, (0...1_000_000).contains(offsetValue.doubleValue) else {
			return json(["ok": false, "error": "kind must be all, images, files, or folders; limit must be an integer from 1 to 200; offset must be an integer from 0 to 1000000."])
		}
		let home = FileManager.default.homeDirectoryForCurrentUser
		let aliases = ["downloads": "Downloads", "desktop": "Desktop", "documents": "Documents"]
		let directory: URL
		if folder.lowercased() == "home" {
			directory = home
		} else if let alias = aliases[folder.lowercased()] {
			directory = home.appendingPathComponent(alias, isDirectory: true)
		} else if folder == "~" || folder.hasPrefix("~/") {
			directory = URL(fileURLWithPath: (folder as NSString).expandingTildeInPath, isDirectory: true).standardizedFileURL
		} else if folder.hasPrefix("/") {
			directory = URL(fileURLWithPath: folder, isDirectory: true).standardizedFileURL
		} else {
			return json(["ok": false, "error": "folder must be downloads, desktop, documents, home, or an absolute path (including ~/)."])
		}
		do {
			let keys: Set<URLResourceKey> = [.isRegularFileKey, .isDirectoryKey, .isSymbolicLinkKey, .fileSizeKey, .contentModificationDateKey]
			let urls = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: Array(keys), options: [.skipsHiddenFiles])
			let query = input["nameContains"] as? String ?? ""
			var entries: [[String: Any]] = []
			for url in urls.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
				if !query.isEmpty && url.lastPathComponent.range(of: query, options: [.caseInsensitive, .diacriticInsensitive]) == nil { continue }
				let values = try url.resourceValues(forKeys: keys)
				let symlink = values.isSymbolicLink == true
				let isFile = values.isRegularFile == true && !symlink
				let isFolder = values.isDirectory == true && !symlink
				let type = UTType(filenameExtension: url.pathExtension)
				let image = isFile && type?.conforms(to: .image) == true
				if kind == "images" && !image || kind == "files" && !isFile || kind == "folders" && !isFolder { continue }
				entries.append([
					"name": url.lastPathComponent, "path": url.path,
					"kind": symlink ? "symlink" : (isFolder ? "folder" : "file"),
					"isImage": image,
					"mimeType": type?.preferredMIMEType as Any? ?? NSNull(),
					"sizeBytes": values.fileSize as Any? ?? NSNull(),
					"modifiedAt": values.contentModificationDate.map { ISO8601DateFormatter().string(from: $0) } as Any? ?? NSNull(),
				])
			}
			let offset = offsetValue.intValue
			let page = Array(entries.dropFirst(offset).prefix(limitValue.intValue))
			let next = offset + page.count
			return json(["ok": true, "data": ["folder": directory.path, "entries": page, "count": page.count, "totalMatches": entries.count, "hasMore": next < entries.count, "nextOffset": next < entries.count ? next as Any : NSNull()]])
		} catch {
			let nsError = error as NSError
			let denied = nsError.code == NSFileReadNoPermissionError || (nsError.domain == NSPOSIXErrorDomain && [1, 13].contains(nsError.code))
			let hint = denied ? " Allow Toby in System Settings > Privacy & Security > Files and Folders for this folder, then retry." : ""
			return json(["ok": false, "error": "Could not list \(directory.path): \(error.localizedDescription)\(hint)", "needsPermission": denied])
		}
	}
}
