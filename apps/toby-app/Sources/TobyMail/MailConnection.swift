import Foundation

/// A byte stream to a mail server. `startTLS()` upgrades a plain connection
/// in place (STARTTLS); implicit-TLS connections start secured.
public protocol MailStream: Sendable {
	func readLine() async throws -> Data
	func readBytes(_ count: Int) async throws -> Data
	func write(_ data: Data) async throws
	func startTLS() async throws
	func close() async
}

public enum MailError: Error, Equatable, LocalizedError, Sendable {
	case connection(String)
	case closed
	case timeout
	case protocolError(String)
	case server(String)
	case notConfigured(String)

	public var errorDescription: String? {
		switch self {
		case let .connection(message): message
		case .closed: "The mail server closed the connection."
		case .timeout: "The mail server didn't respond in time."
		case let .protocolError(message): "Unexpected mail server response: \(message)"
		case let .server(message): message
		case let .notConfigured(message): message
		}
	}
}

/// `URLSessionStreamTask` with line buffering. TLS (implicit or STARTTLS)
/// uses the system trust store and hostname validation.
public actor StreamTaskConnection: MailStream {
	let task: URLSessionStreamTask
	let session: URLSession
	let timeout: TimeInterval
	let host: String
	var buffer = Data()

	public static func open(host: String, port: Int, tls: Bool, timeout: TimeInterval = 60) async throws -> StreamTaskConnection {
		let configuration = URLSessionConfiguration.ephemeral
		configuration.timeoutIntervalForRequest = timeout
		let session = URLSession(configuration: configuration)
		let task = session.streamTask(withHostName: host, port: port)
		task.resume()
		if tls { task.startSecureConnection() }
		return StreamTaskConnection(task: task, session: session, timeout: timeout, host: host)
	}

	init(task: URLSessionStreamTask, session: URLSession, timeout: TimeInterval, host: String = "") {
		self.task = task
		self.session = session
		self.timeout = timeout
		self.host = host
	}

	/// Readable text for stream errors. CFNetwork host-lookup failures
	/// (codes 1 and 2) otherwise surface as "kCFErrorDomainCFNetwork error 2."
	static func describe(_ error: Error, host: String) -> String {
		let nsError = error as NSError
		if nsError.domain == kCFErrorDomainCFNetwork as String, nsError.code == 1 || nsError.code == 2 {
			return "Couldn't find the mail server \"\(host)\". Check the server name."
		}
		return error.localizedDescription
	}

	func fill() async throws {
		let (data, eof): (Data?, Bool)
		do {
			(data, eof) = try await task.readData(ofMinLength: 1, maxLength: 65536, timeout: timeout)
		} catch let error as URLError where error.code == .timedOut {
			throw MailError.timeout
		} catch {
			throw MailError.connection(Self.describe(error, host: host))
		}
		if let data, !data.isEmpty { buffer.append(data) } else if eof { throw MailError.closed }
	}

	public func readLine() async throws -> Data {
		while true {
			if let range = buffer.firstRange(of: Data([13, 10])) {
				let line = buffer[buffer.startIndex ..< range.lowerBound]
				buffer.removeSubrange(buffer.startIndex ..< range.upperBound)
				return Data(line)
			}
			try await fill()
		}
	}

	public func readBytes(_ count: Int) async throws -> Data {
		while buffer.count < count { try await fill() }
		let bytes = buffer.prefix(count)
		buffer.removeFirst(count)
		return Data(bytes)
	}

	public func write(_ data: Data) async throws {
		do {
			try await task.write(data, timeout: timeout)
		} catch {
			throw MailError.connection(Self.describe(error, host: host))
		}
	}

	public func startTLS() async throws {
		buffer.removeAll()
		task.startSecureConnection()
	}

	public func close() async {
		task.closeWrite()
		task.cancel()
		session.invalidateAndCancel()
	}
}

/// Connection settings for one side (IMAP or SMTP).
public struct MailServer: Sendable, Equatable {
	public var host: String
	public var port: Int
	public var secure: Bool
	public var username: String
	public var password: String

	/// Bare hostname from user input: drops a scheme (`imaps://`), path,
	/// trailing dot, and `:port` suffix, none of which resolve via DNS.
	public static func normalizeHost(_ raw: String) -> String {
		var host = Substring(raw.trimmingCharacters(in: .whitespacesAndNewlines))
		if let scheme = host.range(of: "://") { host = host[scheme.upperBound...] }
		if let slash = host.firstIndex(of: "/") { host = host[..<slash] }
		if let at = host.lastIndex(of: "@") { host = host[host.index(after: at)...] }
		if let colon = host.lastIndex(of: ":"), host.firstIndex(of: ":") == colon, host[host.index(after: colon)...].allSatisfy(\.isNumber) {
			host = host[..<colon]
		}
		while host.hasSuffix(".") { host = host.dropLast() }
		return String(host)
	}

	public init(host: String, port: Int, secure: Bool, username: String, password: String) {
		self.host = host
		self.port = port
		self.secure = secure
		self.username = username
		self.password = password
	}
}
