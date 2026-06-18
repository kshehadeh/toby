import Foundation
import Network

private struct NativeHTTPRequest: Sendable {
	let method: String
	let path: String
	let body: Data?
}

private final class NativeHTTPRequestReader: @unchecked Sendable {
	private let connection: NWConnection
	private let onRequest: @Sendable (NativeHTTPRequest) -> Void
	private var buffer = Data()

	init(connection: NWConnection, onRequest: @escaping @Sendable (NativeHTTPRequest) -> Void) {
		self.connection = connection
		self.onRequest = onRequest
	}

	func start() {
		readChunk()
	}

	private func readChunk() {
		connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [self] content, _, isComplete, error in
			if let error {
				print("[native-server] receive error: \(error)")
				connection.cancel()
				return
			}
			if let content {
				buffer.append(content)
			}

			guard let headerEnd = buffer.range(of: Data("\r\n\r\n".utf8)) else {
				if isComplete == true {
					connection.cancel()
					return
				}
				readChunk()
				return
			}

			let headerData = buffer[..<headerEnd.lowerBound]
			guard let headerText = String(data: headerData, encoding: .utf8) else {
				connection.cancel()
				return
			}

			let headerLines = headerText.split(separator: "\r\n")
			guard let requestLine = headerLines.first else {
				connection.cancel()
				return
			}
			let parts = requestLine.split(separator: " ")
			guard parts.count >= 2 else {
				connection.cancel()
				return
			}

			let method = String(parts[0])
			let path = String(parts[1])
			var contentLength = 0
			for line in headerLines.dropFirst() {
				if line.lowercased().hasPrefix("content-length:") {
					contentLength = Int(line.dropFirst("content-length:".count).trimmingCharacters(in: .whitespaces)) ?? 0
				}
			}

			let bodyStart = headerEnd.upperBound
			let bodySoFar = buffer[bodyStart...]
			guard bodySoFar.count >= contentLength || isComplete == true else {
				readChunk()
				return
			}

			let body = contentLength > 0 ? Data(bodySoFar.prefix(contentLength)) : nil
			onRequest(NativeHTTPRequest(method: method, path: path, body: body))
		}
	}
}

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

		newListener.stateUpdateHandler = { [weak self] state in
			switch state {
			case .ready:
				if let portValue = newListener.port {
					let p = UInt16(portValue.rawValue)
					Task { @MainActor in
						self?.port = p
						self?.writePortFile(p)
						print("[native-server] listening on port \(p)")
					}
				}
			case .failed(let error):
				print("[native-server] listener failed: \(error)")
			default:
				break
			}
		}

		newListener.newConnectionHandler = { [weak self] connection in
			connection.start(queue: .global(qos: .utility))
			self?.readRequest(from: connection)
		}

		newListener.start(queue: .global(qos: .utility))
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

	private nonisolated func writePortFile(_ port: UInt16) {
		let home = FileManager.default.homeDirectoryForCurrentUser
		let url = home.appendingPathComponent(".toby/native-port")
		let data = "\(port)".data(using: .utf8)
		try? data?.write(to: url, options: .atomic)
	}

	private nonisolated func deletePortFile() {
		let home = FileManager.default.homeDirectoryForCurrentUser
		let url = home.appendingPathComponent(".toby/native-port")
		try? FileManager.default.removeItem(at: url)
	}

	// MARK: - Request reading

	private nonisolated func readRequest(from connection: NWConnection) {
		let reader = NativeHTTPRequestReader(connection: connection) { request in
			Task { @MainActor in
				let response = await NativeServer.shared.route(request: request)
				connection.send(content: response, completion: .contentProcessed { error in
					if let error {
						print("[native-server] send error: \(error)")
					}
					connection.cancel()
				})
			}
		}
		reader.start()
	}

	// MARK: - Routing (on MainActor)

	private func route(request: NativeHTTPRequest) async -> Data {
		let path = request.path

		guard path.hasPrefix("/api/native/") else {
			return httpResponse(json: ["ok": false, "error": "Not found"], status: 404)
		}

		switch path {
		case "/api/native/health":
			return httpResponse(json: ["ok": true, "service": "toby-native"])
		case "/api/native/calendar/request-access":
			return wrapHandlerData(NativeCalendarHandler.requestAccess())
		case "/api/native/calendar/list":
			return wrapHandlerData(await NativeCalendarHandler.listCalendars())
		case "/api/native/calendar/search":
			return wrapHandlerData(await NativeCalendarHandler.searchEvents(body: request.body))
		case "/api/native/calendar/get":
			return wrapHandlerData(await NativeCalendarHandler.getEvent(body: request.body))
		case "/api/native/calendar/create":
			return wrapHandlerData(await NativeCalendarHandler.createEvent(body: request.body))
		case "/api/native/calendar/update":
			return wrapHandlerData(await NativeCalendarHandler.updateEvent(body: request.body))
		case "/api/native/calendar/delete":
			return wrapHandlerData(await NativeCalendarHandler.deleteEvent(body: request.body))
		case "/api/native/macos/minimize-all":
			return wrapHandlerData(NativeMacOSHandler.minimizeAll())
		case "/api/native/macos/unminimize-all":
			return wrapHandlerData(NativeMacOSHandler.unminimizeAll())
		case "/api/native/macos/minimize-app":
			return wrapHandlerData(NativeMacOSHandler.minimizeApp(body: request.body))
		case "/api/native/macos/unminimize-app":
			return wrapHandlerData(NativeMacOSHandler.unminimizeApp(body: request.body))
		case "/api/native/macos/accessibility-status":
			return wrapHandlerData(NativeMacOSHandler.accessibilityStatus())
		case "/api/native/audio/status":
			return wrapHandlerData(NativeAudioHandler.shared.status())
		case "/api/native/audio/start":
			return wrapHandlerData(await NativeAudioHandler.shared.start(body: request.body))
		case "/api/native/audio/stop":
			return wrapHandlerData(await NativeAudioHandler.shared.stop(body: request.body))
		default:
			return httpResponse(json: ["ok": false, "error": "Unknown endpoint: \(path)"], status: 404)
		}
	}

	// MARK: - Response building

	/// Wraps handler-returned JSON body Data with HTTP headers.
	private nonisolated func wrapHandlerData(_ body: Data) -> Data {
		let header = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
		return Data(header.utf8) + body
	}

	private nonisolated func httpResponse(json payload: [String: Any], status: Int = 200) -> Data {
		let body: Data
		if JSONSerialization.isValidJSONObject(payload),
			let encoded = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
		{
			body = encoded
		} else {
			body = Data("{\"ok\":false,\"error\":\"encoding error\"}".utf8)
		}

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
}
