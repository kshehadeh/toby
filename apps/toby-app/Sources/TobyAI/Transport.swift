import Foundation

/// The HTTP seam under `OpenRouterClient`. Tests substitute `MockTransport`.
public protocol HTTPTransport: Sendable {
	/// Perform a request and return the full body.
	func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
	/// Perform a request and stream the body line by line (for SSE).
	/// On a non-2xx status the implementation returns the status with an
	/// empty line stream; the caller reads `errorBody`.
	func streamLines(_ request: URLRequest) async throws -> StreamedResponse
}

public struct StreamedResponse: Sendable {
	public let response: HTTPURLResponse
	public let lines: AsyncThrowingStream<String, Error>
	/// Body of a failed (non-2xx) response.
	public let errorBody: Data

	public init(response: HTTPURLResponse, lines: AsyncThrowingStream<String, Error>, errorBody: Data = Data()) {
		self.response = response
		self.lines = lines
		self.errorBody = errorBody
	}
}

/// `URLSession`-backed transport.
public struct URLSessionTransport: HTTPTransport {
	private let session: URLSession

	public init(session: URLSession = .shared) {
		self.session = session
	}

	public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
		let (data, response) = try await session.data(for: request)
		guard let http = response as? HTTPURLResponse else {
			throw AIError.invalidResponse("non-HTTP response")
		}
		return (data, http)
	}

	public func streamLines(_ request: URLRequest) async throws -> StreamedResponse {
		let (bytes, response) = try await session.bytes(for: request)
		guard let http = response as? HTTPURLResponse else {
			throw AIError.invalidResponse("non-HTTP response")
		}
		if !(200 ..< 300).contains(http.statusCode) {
			var body = Data()
			for try await byte in bytes {
				body.append(byte)
				if body.count > 64 * 1024 { break }
			}
			return StreamedResponse(response: http, lines: AsyncThrowingStream { $0.finish() }, errorBody: body)
		}
		let lines = AsyncThrowingStream<String, Error> { continuation in
			let task = Task {
				do {
					for try await line in bytes.lines {
						continuation.yield(line)
					}
					continuation.finish()
				} catch {
					continuation.finish(throwing: error)
				}
			}
			continuation.onTermination = { _ in task.cancel() }
		}
		return StreamedResponse(response: http, lines: lines)
	}
}
