import CryptoKit
import Foundation
import Network

/// OpenRouter OAuth (PKCE) sign-in, ported from the TS
/// `ai/provider-setup/openrouter-oauth.ts`.
///
/// 1. `start()` binds a loopback listener on 127.0.0.1 with an unguessable
///    callback path and returns the authorization URL to open in the browser.
/// 2. OpenRouter redirects to `http://localhost:<port>/callback/<nonce>?code=…`.
/// 3. The code is exchanged at `/api/v1/auth/keys` for a user API key.
///
/// Neither the code nor the key ever leaves this process.
public final class OpenRouterSignIn: @unchecked Sendable {
	public enum State: Sendable, Equatable {
		case waiting
		case exchanging
		case completed
		case failed(String)
	}

	public let authorizationURL: URL
	private let verifier: String
	private let callbackPath: String
	private let listener: NWListener
	private let transport: any HTTPTransport
	private let keysEndpoint: URL
	private let lock = NSLock()
	private var continuation: CheckedContinuation<String, Error>?
	private var outcome: Result<String, Error>?
	private var state: State = .waiting
	private let queue = DispatchQueue(label: "app.toby.openrouter-signin")

	/// Bind the loopback listener and build the authorization URL.
	public static func start(
		keyLabel: String = "Toby",
		transport: any HTTPTransport = URLSessionTransport(),
		authorizeEndpoint: URL = URL(string: "https://openrouter.ai/auth")!,
		keysEndpoint: URL = URL(string: "https://openrouter.ai/api/v1/auth/keys")!,
	) async throws -> OpenRouterSignIn {
		let parameters = NWParameters.tcp
		parameters.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: .any)
		parameters.allowLocalEndpointReuse = true
		let listener = try NWListener(using: parameters, on: .any)
		// NWListener requires a connection handler before start(); route through
		// a box until the sign-in object exists.
		let router = ConnectionRouter()
		listener.newConnectionHandler = { connection in router.route(connection) }
		let port = try await Self.waitForPort(listener)
		let verifier = Self.randomToken()
		let callbackPath = "/callback/\(Self.randomToken())"
		var components = URLComponents(url: authorizeEndpoint, resolvingAgainstBaseURL: false)!
		components.queryItems = [
			URLQueryItem(name: "callback_url", value: "http://localhost:\(port)\(callbackPath)"),
			URLQueryItem(name: "code_challenge", value: Self.challenge(for: verifier)),
			URLQueryItem(name: "code_challenge_method", value: "S256"),
			URLQueryItem(name: "key_label", value: keyLabel),
		]
		let signIn = OpenRouterSignIn(
			authorizationURL: components.url!,
			verifier: verifier,
			callbackPath: callbackPath,
			listener: listener,
			transport: transport,
			keysEndpoint: keysEndpoint,
		)
		router.attach { [weak signIn] connection in
			if let signIn { signIn.handle(connection) } else { connection.cancel() }
		}
		return signIn
	}

	private init(
		authorizationURL: URL,
		verifier: String,
		callbackPath: String,
		listener: NWListener,
		transport: any HTTPTransport,
		keysEndpoint: URL,
	) {
		self.authorizationURL = authorizationURL
		self.verifier = verifier
		self.callbackPath = callbackPath
		self.listener = listener
		self.transport = transport
		self.keysEndpoint = keysEndpoint
	}

	public var currentState: State {
		lock.withLock { state }
	}

	/// Wait for the browser round-trip and key exchange. Returns the API key.
	public func waitForKey(timeout: Duration = .seconds(600)) async throws -> String {
		try await withThrowingTaskGroup(of: String.self) { group in
			group.addTask {
				try await withCheckedThrowingContinuation { continuation in
					self.lock.lock()
					if let outcome = self.outcome {
						self.lock.unlock()
						continuation.resume(with: outcome)
					} else {
						self.continuation = continuation
						self.lock.unlock()
					}
				}
			}
			group.addTask {
				try await Task.sleep(for: timeout)
				throw AIError.provider(message: "Sign-in expired. Connect your account again.", code: nil)
			}
			defer {
				group.cancelAll()
				self.cancel()
			}
			guard let key = try await group.next() else { throw AIError.cancelled }
			return key
		}
	}

	public func cancel() {
		listener.cancel()
		resolve(.failure(AIError.cancelled))
	}

	// MARK: Callback handling

	private func handle(_ connection: NWConnection) {
		connection.start(queue: queue)
		connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, _, _ in
			guard let self else { return }
			let request = String(decoding: data ?? Data(), as: UTF8.self)
			let (status, message) = self.process(requestText: request)
			let html = "<!doctype html><meta charset=utf-8><title>Toby</title><body style=\"font:16px -apple-system;padding:48px\">\(message)</body>"
			let response = "HTTP/1.1 \(status)\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(html.utf8.count)\r\nConnection: close\r\n\r\n\(html)"
			connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in connection.cancel() })
		}
	}

	/// Parse the request line and react. Returns HTTP status + page text.
	func process(requestText: String) -> (String, String) {
		let firstLine = requestText.split(separator: "\r\n", maxSplits: 1).first.map(String.init) ?? ""
		let parts = firstLine.split(separator: " ")
		guard parts.count >= 2, parts[0] == "GET",
		      let components = URLComponents(string: "http://localhost\(parts[1])"),
		      components.path == callbackPath
		else { return ("404 Not Found", "Not found") }

		let isWaiting = lock.withLock { () -> Bool in
			guard state == .waiting else { return false }
			state = .exchanging
			return true
		}
		guard isWaiting else {
			return ("409 Conflict", "This sign-in has ended. Return to Toby to start again.")
		}
		let items = components.queryItems ?? []
		if items.contains(where: { $0.name == "error" }) {
			resolve(.failure(AIError.provider(message: "Sign-in wasn’t approved. You can try again or paste an existing key.", code: nil)))
			return ("200 OK", "Sign-in wasn’t approved. You can return to Toby.")
		}
		let codes = items.filter { $0.name == "code" }.compactMap(\.value)
		guard codes.count == 1, let code = codes.first, !code.isEmpty, code.count <= 4096 else {
			resolve(.failure(AIError.provider(message: "The sign-in response was incomplete. Try again.", code: nil)))
			return ("400 Bad Request", "The sign-in response was incomplete. Return to Toby and try again.")
		}
		Task { await self.exchange(code: code) }
		return ("200 OK", "Sign-in received. Return to Toby to finish connecting.")
	}

	private func exchange(code: String) async {
		do {
			var request = URLRequest(url: keysEndpoint)
			request.httpMethod = "POST"
			request.timeoutInterval = 15
			request.setValue("application/json", forHTTPHeaderField: "Content-Type")
			let body: JSONValue = [
				"code": .string(code),
				"code_verifier": .string(verifier),
				"code_challenge_method": "S256",
			]
			request.httpBody = try JSONEncoder.toby.encode(body)
			let (data, response) = try await transport.send(request)
			guard (200 ..< 300).contains(response.statusCode),
			      let key = (try? JSONDecoder().decode(JSONValue.self, from: data))?["key"]?.stringValue,
			      !key.trimmingCharacters(in: .whitespaces).isEmpty
			else {
				throw AIError.provider(message: "OpenRouter didn’t return a key. Try signing in again.", code: nil)
			}
			resolve(.success(key))
		} catch let error as AIError {
			resolve(.failure(error))
		} catch {
			// Never echo transport errors that could include request details.
			resolve(.failure(AIError.provider(message: "Toby couldn’t finish signing in. Try again.", code: nil)))
		}
	}

	private func resolve(_ result: Result<String, Error>) {
		lock.lock()
		guard outcome == nil else {
			lock.unlock()
			return
		}
		outcome = result
		switch result {
		case .success: state = .completed
		case let .failure(error): state = .failed((error as? LocalizedError)?.errorDescription ?? "Sign-in failed.")
		}
		let pending = continuation
		continuation = nil
		lock.unlock()
		pending?.resume(with: result)
		if case .success = result { listener.cancel() }
	}

	// MARK: Helpers

	private static func waitForPort(_ listener: NWListener) async throws -> UInt16 {
		try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<UInt16, Error>) in
			let once = OnceFlag()
			listener.stateUpdateHandler = { state in
				switch state {
				case .ready:
					if once.claim() { continuation.resume(returning: listener.port?.rawValue ?? 0) }
				case let .failed(error):
					if once.claim() { continuation.resume(throwing: error) }
				default:
					break
				}
			}
			listener.start(queue: DispatchQueue(label: "app.toby.openrouter-signin.listener"))
		}
	}

	static func randomToken() -> String {
		var bytes = [UInt8](repeating: 0, count: 32)
		_ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
		return Data(bytes).base64URLEncoded()
	}

	static func challenge(for verifier: String) -> String {
		Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncoded()
	}
}

/// Holds connections until the sign-in object is ready to handle them.
final class ConnectionRouter: @unchecked Sendable {
	private let lock = NSLock()
	private var handler: ((NWConnection) -> Void)?
	private var queued: [NWConnection] = []

	func route(_ connection: NWConnection) {
		lock.lock()
		if let handler {
			lock.unlock()
			handler(connection)
		} else {
			queued.append(connection)
			lock.unlock()
		}
	}

	func attach(_ handler: @escaping (NWConnection) -> Void) {
		lock.lock()
		self.handler = handler
		let pending = queued
		queued.removeAll()
		lock.unlock()
		pending.forEach(handler)
	}
}

/// Thread-safe "first caller wins" flag.
final class OnceFlag: @unchecked Sendable {
	private let lock = NSLock()
	private var claimed = false

	func claim() -> Bool {
		lock.withLock {
			if claimed { return false }
			claimed = true
			return true
		}
	}
}

extension Data {
	func base64URLEncoded() -> String {
		base64EncodedString()
			.replacingOccurrences(of: "+", with: "-")
			.replacingOccurrences(of: "/", with: "_")
			.replacingOccurrences(of: "=", with: "")
	}
}
