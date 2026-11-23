import CryptoKit
import Foundation
import Network
import TobyAI

/// Slack OAuth v2 with PKCE on the registered loopback redirect
/// (`http://localhost:9878/callback`, port of `plugin-slack/src/auth.ts`).
/// Localhost redirects only allow user scopes.
public final class SlackSignIn: @unchecked Sendable {
	public static let defaultRedirectURI = "http://localhost:9878/callback"
	public static let userScopes = [
		"channels:read", "channels:history", "chat:write", "groups:read", "groups:history", "im:read", "im:history",
		"mpim:read", "mpim:history", "users:read", "users:read.email", "search:read",
	].joined(separator: ",")

	public let authorizationURL: URL
	let clientID: String
	let clientSecret: String?
	let redirectURI: String
	let verifier: String
	let state: String
	let path: String
	let listener: NWListener
	let transport: any HTTPTransport
	let queue = DispatchQueue(label: "app.toby.slack-signin")
	let lock = NSLock()
	var continuation: CheckedContinuation<String, Error>?
	var outcome: Result<String, Error>?

	static func token(_ bytes: Int = 32) -> String {
		var raw = [UInt8](repeating: 0, count: bytes)
		_ = SecRandomCopyBytes(kSecRandomDefault, raw.count, &raw)
		return Data(raw).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
	}

	public init(clientID: String, clientSecret: String?, redirectURI: String?, transport: any HTTPTransport = URLSessionTransport()) throws {
		let redirect = redirectURI?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? Self.defaultRedirectURI
		guard let parsed = URLComponents(string: redirect), parsed.scheme == "http", parsed.host == "localhost" || parsed.host == "127.0.0.1",
		      let port = parsed.port, let nwPort = NWEndpoint.Port(rawValue: UInt16(port)) else {
			throw SlackError.api("Slack OAuth redirect URI must use http://localhost (got: \(redirect))")
		}
		self.clientID = clientID
		self.clientSecret = clientSecret?.nilIfEmpty
		self.redirectURI = redirect
		path = parsed.path.isEmpty ? "/" : parsed.path
		verifier = Self.token()
		state = Self.token()
		self.transport = transport
		let parameters = NWParameters.tcp
		parameters.allowLocalEndpointReuse = true
		do { listener = try NWListener(using: parameters, on: nwPort) } catch {
			throw SlackError.api("Port \(port) is in use. Close whatever is using it and try again.")
		}
		let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64EncodedString()
			.replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
		var components = URLComponents(string: "https://slack.com/oauth/v2/authorize")!
		components.queryItems = [
			URLQueryItem(name: "client_id", value: clientID), URLQueryItem(name: "user_scope", value: Self.userScopes),
			URLQueryItem(name: "redirect_uri", value: redirect), URLQueryItem(name: "code_challenge", value: challenge),
			URLQueryItem(name: "code_challenge_method", value: "S256"), URLQueryItem(name: "state", value: state),
		]
		authorizationURL = components.url!
		listener.newConnectionHandler = { [weak self] connection in
			if let self { self.handle(connection) } else { connection.cancel() }
		}
		listener.start(queue: queue)
	}

	/// Wait for the callback; returns the `oauth.v2.access` secrets patch.
	public func waitForTokens(timeout: Duration = .seconds(180)) async throws -> [String: String] {
		let code: String = try await withThrowingTaskGroup(of: String.self) { group in
			group.addTask {
				try await withCheckedThrowingContinuation { continuation in
					self.lock.lock()
					if let outcome = self.outcome { self.lock.unlock(); continuation.resume(with: outcome) } else { self.continuation = continuation; self.lock.unlock() }
				}
			}
			group.addTask {
				try await Task.sleep(for: timeout)
				throw SlackError.api("Slack sign-in timed out. Try connecting again.")
			}
			defer { group.cancelAll(); self.cancel() }
			return try await group.next()!
		}
		var params = ["client_id": clientID, "code": code, "redirect_uri": redirectURI, "code_verifier": verifier]
		if let clientSecret { params["client_secret"] = clientSecret }
		var request = URLRequest(url: URL(string: "https://slack.com/api/oauth.v2.access")!)
		request.httpMethod = "POST"
		request.timeoutInterval = 15
		request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
		request.httpBody = SlackAPI.form(params)
		let (data, _) = try await transport.send(request)
		let json = try JSONDecoder().decode(JSONValue.self, from: data)
		return try Self.tokens(from: json)
	}

	static func tokens(from json: JSONValue, now: Date = Date()) throws -> [String: String] {
		let user = json["authed_user"]?["access_token"]?.stringValue
		let bot = json["access_token"]?.stringValue
		guard json["ok"] == true, user != nil || bot != nil else {
			throw SlackError.api("Slack OAuth failed: \(json["error"]?.stringValue ?? "missing access token")")
		}
		var patch: [String: String] = ["authMethod": "oauth", "teamId": json["team"]?["id"]?.stringValue ?? "", "teamName": json["team"]?["name"]?.stringValue ?? ""]
		patch["oauthUserToken"] = user ?? ""
		patch["oauthUserRefreshToken"] = json["authed_user"]?["refresh_token"]?.stringValue ?? ""
		patch["oauthBotToken"] = bot ?? ""
		patch["oauthBotRefreshToken"] = json["refresh_token"]?.stringValue ?? ""
		let expires = (user != nil ? json["authed_user"]?["expires_in"] : json["expires_in"])?.doubleValue
		patch["oauthExpiresAt"] = expires.map { TodoRecurrence.isoString(now.addingTimeInterval($0)) } ?? ""
		return patch
	}

	public func cancel() {
		listener.cancel()
		resolve(.failure(CancellationError()))
	}

	func resolve(_ result: Result<String, Error>) {
		lock.lock()
		guard outcome == nil else { lock.unlock(); return }
		outcome = result
		let waiting = continuation
		continuation = nil
		lock.unlock()
		waiting?.resume(with: result)
	}

	func handle(_ connection: NWConnection) {
		connection.start(queue: queue)
		connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, _, _ in
			guard let self else { return }
			let line = String(decoding: data ?? Data(), as: UTF8.self).components(separatedBy: "\r\n").first ?? ""
			let parts = line.split(separator: " ")
			var message = "Not found."
			var status = "404 Not Found"
			if parts.count >= 2, let components = URLComponents(string: "http://localhost\(parts[1])"), components.path == self.path {
				let query = Dictionary((components.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { a, _ in a })
				if let error = query["error"] {
					(status, message) = ("400 Bad Request", "Slack sign-in failed: \(error). You can close this tab.")
					self.resolve(.failure(SlackError.api("Slack sign-in failed: \(error)")))
				} else if query["state"] != self.state || (query["code"] ?? "").isEmpty {
					(status, message) = ("400 Bad Request", "Invalid sign-in response.")
				} else {
					(status, message) = ("200 OK", "Slack is connected to Toby. You can close this tab.")
					self.resolve(.success(query["code"]!))
				}
			}
			let html = "<!doctype html><meta charset=utf-8><title>Toby</title><body style=\"font:16px -apple-system;padding:48px\">\(message)</body>"
			let response = "HTTP/1.1 \(status)\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(html.utf8.count)\r\nConnection: close\r\n\r\n\(html)"
			connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in connection.cancel() })
		}
	}
}
