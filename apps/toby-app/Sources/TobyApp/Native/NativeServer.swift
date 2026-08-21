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

	static let shared = NativeServer()

	private init() {}

	/// Port advertisement file under the current Toby home (`native-port`).
	/// Recomputed each write so a mid-session home switch lands in the new root.
	private nonisolated static func portFileURL() -> URL {
		URL(fileURLWithPath: ConfigReader.resolveTobyDir())
			.appendingPathComponent("native-port")
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
		let url = Self.portFileURL()
		// Ensure the home directory exists before advertising the port.
		try? FileManager.default.createDirectory(
			at: url.deletingLastPathComponent(),
			withIntermediateDirectories: true
		)
		let data = "\(port)".data(using: .utf8)
		try? data?.write(to: url, options: .atomic)
	}

	private nonisolated func deletePortFile() {
		try? FileManager.default.removeItem(at: Self.portFileURL())
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
		case "/api/native/contacts/request-access":
			return wrapHandlerData(await NativeContactsHandler.requestAccess())
		case "/api/native/contacts/search":
			return wrapHandlerData(await NativeContactsHandler.searchContacts(body: request.body))
		case "/api/native/contacts/get":
			return wrapHandlerData(await NativeContactsHandler.getContact(body: request.body))
		case "/api/native/calendar/request-access":
			return wrapHandlerData(await NativeCalendarHandler.requestAccess())
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
		case "/api/native/reminders/request-access":
			return wrapHandlerData(await NativeAppleRemindersHandler.requestAccess())
		case "/api/native/reminders/lists":
			return wrapHandlerData(await NativeAppleRemindersHandler.listReminderLists())
		case "/api/native/reminders/search":
			return wrapHandlerData(await NativeAppleRemindersHandler.searchReminders(body: request.body))
		case "/api/native/reminders/get":
			return wrapHandlerData(await NativeAppleRemindersHandler.getReminder(body: request.body))
		case "/api/native/reminders/create":
			return wrapHandlerData(await NativeAppleRemindersHandler.createReminder(body: request.body))
		case "/api/native/reminders/update":
			return wrapHandlerData(await NativeAppleRemindersHandler.updateReminder(body: request.body))
		case "/api/native/reminders/complete":
			return wrapHandlerData(await NativeAppleRemindersHandler.completeReminder(body: request.body))
		case "/api/native/reminders/delete":
			return wrapHandlerData(await NativeAppleRemindersHandler.deleteReminder(body: request.body))
		case "/api/native/schedules/completion-notification":
			return wrapHandlerData(await NativeMacOSHandler.scheduleCompletionNotification(body: request.body))
		case "/api/native/macos/accessibility-status":
			return wrapHandlerData(NativeMacOSHandler.accessibilityStatus())
		case "/api/native/macos/wifi-status":
			return wrapHandlerData(NativeMacOSHandler.wifiStatus())
		case "/api/native/macos/wifi-scan":
			return wrapHandlerData(NativeMacOSHandler.wifiScan())
		case "/api/native/macos/wifi-set-power":
			return wrapHandlerData(NativeMacOSHandler.wifiSetPower(body: request.body))
		case "/api/native/macos/battery-status":
			return wrapHandlerData(NativeMacOSHandler.batteryStatus())
		case "/api/native/macos/audio-list-outputs":
			return wrapHandlerData(NativeMacOSHandler.audioListOutputs())
		case "/api/native/macos/audio-switch-output":
			return wrapHandlerData(NativeMacOSHandler.audioSwitchOutput(body: request.body))
		case "/api/native/macos/audio-volume":
			return wrapHandlerData(NativeMacOSHandler.audioVolume())
		case "/api/native/macos/audio-set-volume":
			return wrapHandlerData(NativeMacOSHandler.audioSetVolume(body: request.body))
		case "/api/native/macos/audio-set-mute":
			return wrapHandlerData(NativeMacOSHandler.audioSetMute(body: request.body))
		case "/api/native/macos/bluetooth-status":
			return wrapHandlerData(NativeMacOSHandler.bluetoothStatus())
		case "/api/native/macos/bluetooth-set-power":
			return wrapHandlerData(NativeMacOSHandler.bluetoothSetPower(body: request.body))
		case "/api/native/macos/low-power-status":
			return wrapHandlerData(NativeMacOSHandler.lowPowerStatus())
		case "/api/native/macos/low-power-set":
			return wrapHandlerData(NativeMacOSHandler.lowPowerSet(body: request.body))
		case "/api/native/macos/shortcuts-run":
			return wrapHandlerData(NativeMacOSHandler.shortcutsRun(body: request.body))
		case "/api/native/macos/display-brightness":
			return wrapHandlerData(NativeMacOSHandler.displayBrightness())
		case "/api/native/macos/display-set-brightness":
			return wrapHandlerData(NativeMacOSHandler.displaySetBrightness(body: request.body))
		case "/api/native/macos/clipboard-read":
			return wrapHandlerData(NativeMacOSHandler.clipboardRead())
		case "/api/native/macos/clipboard-write":
			return wrapHandlerData(NativeMacOSHandler.clipboardWrite(body: request.body))
		case "/api/native/macos/system-info":
			return wrapHandlerData(NativeMacOSHandler.systemInfo())
		case "/api/native/macos/notification-show":
			return wrapHandlerData(await NativeMacOSHandler.notificationShow(body: request.body))
		case "/api/native/macos/minimize-all":
			return wrapHandlerData(NativeMacOSHandler.minimizeAll())
		case "/api/native/macos/unminimize-all":
			return wrapHandlerData(NativeMacOSHandler.unminimizeAll())
		case "/api/native/macos/minimize-app":
			return wrapHandlerData(NativeMacOSHandler.minimizeApp(body: request.body))
		case "/api/native/macos/unminimize-app":
			return wrapHandlerData(NativeMacOSHandler.unminimizeApp(body: request.body))
		case "/api/native/macos/windows-hide-all":
			return wrapHandlerData(NativeMacOSHandler.windowsHideAll())
		case "/api/native/macos/windows-show-all":
			return wrapHandlerData(NativeMacOSHandler.windowsShowAll())
		case "/api/native/macos/window-hide-app":
			return wrapHandlerData(NativeMacOSHandler.windowHideApp(body: request.body))
		case "/api/native/location/status":
			return wrapHandlerData(NativeLocationHandler.shared.status())
		case "/api/native/location/request-access":
			return wrapHandlerData(await NativeLocationHandler.shared.requestAccess())
		case "/api/native/location/current":
			return wrapHandlerData(await NativeLocationHandler.shared.currentLocation(body: request.body))
		case "/api/native/audio/status":
			return wrapHandlerData(NativeAudioHandler.shared.status())
		case "/api/native/audio/start":
			return wrapHandlerData(await NativeAudioHandler.shared.start(body: request.body))
		case "/api/native/audio/stop":
			return wrapHandlerData(await NativeAudioHandler.shared.stop(body: request.body))
		case "/api/native/audio/combine":
			return wrapHandlerData(await NativeAudioHandler.shared.combine(body: request.body))
		case "/api/native/icloud/status":
			return wrapHandlerData(NativeICloudHandler.status())
		case "/api/native/icloud/ensure":
			return wrapHandlerData(NativeICloudHandler.ensure(body: request.body))
		case "/api/native/icloud/read":
			return wrapHandlerData(NativeICloudHandler.read(body: request.body))
		case "/api/native/icloud/write":
			return wrapHandlerData(NativeICloudHandler.write(body: request.body))
		case "/api/native/icloud/history":
			return wrapHandlerData(NativeICloudHandler.history())
		case "/api/native/icloud/delete":
			return wrapHandlerData(NativeICloudHandler.deleteAll())
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
