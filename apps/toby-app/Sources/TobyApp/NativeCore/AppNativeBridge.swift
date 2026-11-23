import Foundation
import TobyAI
import TobyCore

/// `NativeBridge` backed by the app's handlers (same routes the daemon used ).
struct AppNativeBridge: NativeBridge {
	func call(_ endpoint: String, _ body: JSONValue) async -> JSONValue {
		let data = await NativeDispatcher.shared.dispatch(endpoint: endpoint, body: Data(body.jsonString().utf8))
		return (try? JSONDecoder().decode(JSONValue.self, from: data)) ?? ["ok": false, "error": "Invalid native response"]
	}
}
