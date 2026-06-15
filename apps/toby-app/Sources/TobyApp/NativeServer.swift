import Foundation
import Network

@MainActor
final class NativeServer {
	private var listener: NWListener?
	private var port: UInt16?
	private let portFileURL: URL

	static let shared = NativeServer()

	private init() {
		let home = FileManager.default.homeDirectoryForCurrentUser
		portFileURL = home.appendingPathComponent(".toby/native-port")
	}

	func start() {
		guard listener == nil else { return }

		let params = NWParameters.tcp
		params.allowLocalEndpointReuse = true

		let newListener: NWListener
		do {
			newListener = try NWListener(using: params, on: .any)
		} catch {
			print("[native-server] failed to create listener: \(error)")
			return
		}

		newListener.stateUpdateHandler = { state in
			switch state {
			case .ready:
				if let portValue = newListener.port {
					Task { @MainActor in
						self.port = UInt16(portValue.rawValue)
						self.writePortFile(self.port!)
						print("[native-server] listening on port \(self.port!)")
					}
				}
			case .failed(let error):
				print("[native-server] listener failed: \(error)")
			default:
				break
			}
		}

		newListener.newConnectionHandler = { connection in
			Task { @MainActor in
				self.handleConnection(connection)
			}
		}

		newListener.start(queue: .main)
		listener = newListener
	}

	func stop() {
		listener?.cancel()
		listener = nil
		deletePortFile()
		port = nil
		print("[native-server] stopped")
	}

	// MARK: - Port file

	private func writePortFile(_ port: UInt16) {
		let data = "\(port)".data(using: .utf8)
		try? data?.write(to: portFileURL, options: .atomic)
	}

	private func deletePortFile() {
		try? FileManager.default.removeItem(at: portFileURL)
	}

	// MARK: - Connection handling

	private func handleConnection(_ connection: NWConnection) {
		connection.start(queue: .main)

		var buffer = Data()
		let receiveBuffer: (_: Data?) -> Void = { [weak self] data in
			guard let self, let data else { return }
			buffer.append(data)

			guard let request = self.parseHTTPRequest(buffer) else { return }

			Task { @MainActor in
				let response = await self.route(request: request)
				self.sendResponse(response, on: connection)
				connection.cancel()
			}
		}

		connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { content, _, _, error in
			if let error {
				print("[native-server] receive error: \(error)")
				connection.cancel()
				return
			}
			receiveBuffer(content)
		}
	}

	// MARK: - HTTP parsing

	private struct HTTPRequest {
		let method: String
		let path: String
		let body: Data?
	}

	private func parseHTTPRequest(_ data: Data) -> HTTPRequest? {
		guard let text = String(data: data, encoding: .utf8) else { return nil }
		guard let headerEnd = text.range(of: "\r\n\r\n") else { return nil }

		let headerSection = String(text[..<headerEnd.lowerBound])
		let headerLines = headerSection.split(separator: "\r\n")
		guard let requestLine = headerLines.first else { return nil }

		let parts = requestLine.split(separator: " ")
		guard parts.count >= 2 else { return nil }

		let method = String(parts[0])
		let path = String(parts[1])

		var bodyLength = 0
		for line in headerLines.dropFirst() {
			let lower = line.lowercased()
			if lower.hasPrefix("content-length:") {
				bodyLength = Int(line.dropFirst("content-length:".count).trimmingCharacters(in: .whitespaces)) ?? 0
			}
		}

		let bodyStart = headerEnd.upperBound
		let bodyData = text[bodyStart...].data(using: .utf8)
		if bodyLength > 0, bodyData?.count ?? 0 < bodyLength {
			return nil
		}

		return HTTPRequest(method: method, path: path, body: bodyLength > 0 ? bodyData : nil)
	}

	// MARK: - Routing

	private func route(request: HTTPRequest) async -> Data {
		let path = request.path

		guard path.hasPrefix("/api/native/") else {
			return jsonResponse(["ok": false, "error": "Not found"], status: 404)
		}

		switch path {
		case "/api/native/health":
			return jsonResponse(["ok": true, "service": "toby-native"])
		case "/api/native/calendar/request-access":
			return NativeCalendarHandler.requestAccess()
		case "/api/native/calendar/list":
			return NativeCalendarHandler.listCalendars()
		case "/api/native/calendar/search":
			return NativeCalendarHandler.searchEvents(body: request.body)
		case "/api/native/calendar/get":
			return NativeCalendarHandler.getEvent(body: request.body)
		case "/api/native/calendar/create":
			return NativeCalendarHandler.createEvent(body: request.body)
		case "/api/native/calendar/update":
			return NativeCalendarHandler.updateEvent(body: request.body)
		case "/api/native/calendar/delete":
			return NativeCalendarHandler.deleteEvent(body: request.body)
		case "/api/native/macos/minimize-all":
			return NativeMacOSHandler.minimizeAll()
		case "/api/native/macos/minimize-app":
			return NativeMacOSHandler.minimizeApp(body: request.body)
		case "/api/native/macos/accessibility-status":
			return NativeMacOSHandler.accessibilityStatus()
		default:
			return jsonResponse(["ok": false, "error": "Unknown endpoint: \(path)"], status: 404)
		}
	}

	// MARK: - Response

	private func jsonResponse(_ payload: [String: Any], status: Int = 200) -> Data {
		guard JSONSerialization.isValidJSONObject(payload),
			let body = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
		else {
			let fallback = "{\"ok\":false,\"error\":\"internal encoding error\"}".data(using: .utf8)!
			return httpResponse(body: fallback, status: 500)
		}
		return httpResponse(body: body, status: status)
	}

	private func httpResponse(body: Data, status: Int) -> Data {
		let statusText: String
		switch status {
		case 200: statusText = "OK"
		case 404: statusText = "Not Found"
		case 500: statusText = "Internal Server Error"
		default: statusText = "Status \(status)"
		}
		let header = "HTTP/1.1 \(status) \(statusText)\r\nContent-Type: application/json\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
		return Data(header.utf8) + body
	}

	private func sendResponse(_ data: Data, on connection: NWConnection) {
		connection.send(content: data, completion: .contentProcessed { error in
			if let error {
				print("[native-server] send error: \(error)")
			}
		})
	}
}
