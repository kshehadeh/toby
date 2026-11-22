import Foundation
import TobyCore
import TobyStore

extension ConfigReader {
	/// Resolve a daemon-relative asset path (e.g. `/api/personas/image/toby.png`).
	/// In native mode persona portraits and skill icons come from disk.
	static func assetURL(_ path: String) -> URL? {
		if NativeMode.isEnabled, let local = nativeAssetURL(path) { return local }
		return URL(string: baseURL().absoluteString + path)
	}

	static func nativeAssetURL(_ path: String) -> URL? {
		let clean = path.split(separator: "?").first.map(String.init) ?? path
		let parts = clean.split(separator: "/").map { String($0).removingPercentEncoding ?? String($0) }
		let home = TobyPaths.current().root
		if parts.count == 4, parts[0] == "api", parts[1] == "personas", parts[2] == "image" {
			return PersonaService(tobyDirectory: home).imageURL(for: parts[3])
		}
		if parts.count == 4, parts[0] == "api", parts[1] == "skills", parts[3] == "icon" {
			return SkillService(root: home.appending(path: "skills")).iconURL(dirName: parts[2])
		}
		return nil
	}
}
