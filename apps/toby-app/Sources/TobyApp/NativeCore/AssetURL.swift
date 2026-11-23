import Foundation
import TobyCore
import TobyStore

extension ConfigReader {
	/// Resolve an asset path (e.g. `/api/personas/image/toby.png`) to a file on
	/// disk: persona portraits and skill icons. Absolute URLs pass through.
	static func assetURL(_ path: String) -> URL? {
		if let local = nativeAssetURL(path) { return local }
		if let url = URL(string: path), url.scheme != nil { return url }
		return nil
	}

	/// The default persona portrait (bundled).
	static var defaultPersonaImageURL: URL {
		assetURL("/api/personas/image/default.png")
			?? Bundle.tobyResources.url(forResource: "default-persona", withExtension: "png")
			?? URL(fileURLWithPath: "/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/UserIcon.icns")
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
