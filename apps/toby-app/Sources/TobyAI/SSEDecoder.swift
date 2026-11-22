import Foundation

/// Decodes an OpenAI/OpenRouter-style SSE stream into JSON payloads.
///
/// Each event is one or more `data:` lines; `data: [DONE]` ends the stream.
/// Comment lines (`: OPENROUTER PROCESSING`) are ignored. Because line
/// iterators may swallow the blank separator lines, an event is emitted as
/// soon as the accumulated `data:` text parses as JSON.
enum SSEDecoder {
	static func events(from lines: AsyncThrowingStream<String, Error>) -> AsyncThrowingStream<JSONValue, Error> {
		AsyncThrowingStream { continuation in
			let task = Task {
				var pending: [String] = []
				do {
					for try await rawLine in lines {
						let line = rawLine.hasSuffix("\r") ? String(rawLine.dropLast()) : rawLine
						if line.isEmpty || line.hasPrefix(":") { continue }
						guard line.hasPrefix("data:") else { continue }
						var payload = Substring(line.dropFirst(5))
						if payload.first == " " { payload = payload.dropFirst() }
						if payload == "[DONE]" { break }
						pending.append(String(payload))
						let joined = pending.joined(separator: "\n")
						if let value = try? JSONValue(parsing: joined) {
							pending.removeAll()
							continuation.yield(value)
						}
					}
					if !pending.isEmpty {
						throw AIError.invalidResponse("truncated stream event")
					}
					continuation.finish()
				} catch {
					continuation.finish(throwing: error)
				}
			}
			continuation.onTermination = { _ in task.cancel() }
		}
	}
}
