import Foundation
import TobyAI

/// Access to the app's macOS-framework handlers (EventKit, Contacts, system
/// controls…). The app implements this by dispatching to its native handlers
/// in-process; responses use the `{ok, data, error, needsPermission}` envelope.
public protocol NativeBridge: Sendable {
	func call(_ endpoint: String, _ body: JSONValue) async -> JSONValue
}

public struct NativeBridgeError: Error, Sendable, LocalizedError {
	public var message: String
	public var needsPermission: Bool
	public var errorDescription: String? { message }
}

extension NativeBridge {
	/// Call and unwrap `data`, throwing on `ok: false`.
	public func data(_ endpoint: String, _ body: JSONValue = .object([:])) async throws -> JSONValue {
		let response = await call(endpoint, body)
		guard response["ok"] == true else {
			throw NativeBridgeError(message: response["error"]?.stringValue ?? "\(endpoint) failed.", needsPermission: response["needsPermission"] == true)
		}
		return response["data"] ?? .null
	}
}
