import Foundation

enum ConfigReader {
	static func resolveDaemonPort() -> Int {
		let home = FileManager.default.homeDirectoryForCurrentUser
		let configURL = home.appendingPathComponent(".toby/config.json")
		guard
			let data = try? Data(contentsOf: configURL),
			let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
			let web = json["web"] as? [String: Any],
			let port = web["port"] as? Int
		else {
			return 7847
		}
		return port
	}

	static func baseURL() -> URL {
		URL(string: "http://127.0.0.1:\(resolveDaemonPort())")!
	}
}
