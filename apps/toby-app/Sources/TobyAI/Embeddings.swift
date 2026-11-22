import Accelerate
import Foundation

public struct EmbeddingResult: Sendable {
	public var embeddings: [[Float]]
	public var usage: Usage
}

extension EmbeddingModel {
	/// Embed one text.
	public func embed(_ text: String) async throws -> [Float] {
		guard let first = try await embedMany([text]).embeddings.first else {
			throw AIError.invalidResponse("no embedding returned")
		}
		return first
	}

	/// Embed many texts, batching requests (order preserved).
	public func embedMany(_ texts: [String], batchSize: Int = 96) async throws -> EmbeddingResult {
		guard !texts.isEmpty else { return EmbeddingResult(embeddings: [], usage: .zero) }
		var all: [[Float]] = []
		var usage = Usage.zero
		var start = 0
		while start < texts.count {
			let batch = Array(texts[start ..< min(start + batchSize, texts.count)])
			let body: JSONValue = [
				"model": .string(id),
				"input": .array(batch.map { JSONValue.string($0) }),
			]
			let response = try await Retry.transient {
				try await client.json(path: "embeddings", body: body)
			}
			usage = usage + (WireFormat.usage(from: response["usage"]) ?? .zero)
			let rows = (response["data"]?.arrayValue ?? []).sorted {
				($0["index"]?.intValue ?? 0) < ($1["index"]?.intValue ?? 0)
			}
			guard rows.count == batch.count else {
				throw AIError.invalidResponse("expected \(batch.count) embeddings, got \(rows.count)")
			}
			for row in rows {
				all.append((row["embedding"]?.arrayValue ?? []).map { Float($0.doubleValue ?? 0) })
			}
			start += batchSize
		}
		return EmbeddingResult(embeddings: all, usage: usage)
	}
}

/// Vector helpers (replaces `ai/vector.ts`).
public enum VectorMath {
	public static func cosineSimilarity(_ a: [Float], _ b: [Float]) -> Float {
		guard a.count == b.count, !a.isEmpty else { return 0 }
		var dot: Float = 0
		var normA: Float = 0
		var normB: Float = 0
		vDSP_dotpr(a, 1, b, 1, &dot, vDSP_Length(a.count))
		vDSP_svesq(a, 1, &normA, vDSP_Length(a.count))
		vDSP_svesq(b, 1, &normB, vDSP_Length(b.count))
		let denominator = (normA * normB).squareRoot()
		return denominator > 0 ? dot / denominator : 0
	}

	/// Brute-force top-K by cosine similarity.
	public static func topK<ID>(
		query: [Float],
		candidates: [(id: ID, vector: [Float])],
		k: Int,
		minScore: Float = -1,
	) -> [(id: ID, score: Float)] {
		candidates
			.map { (id: $0.id, score: cosineSimilarity(query, $0.vector)) }
			.filter { $0.score >= minScore }
			.sorted { $0.score > $1.score }
			.prefix(k)
			.map(\.self)
	}

	/// Little-endian Float32 blob, compatible with the legacy TS `vectorToBuffer`.
	public static func blob(_ vector: [Float]) -> Data {
		vector.withUnsafeBufferPointer { Data(buffer: $0) }
	}

	public static func vector(fromBlob data: Data) -> [Float] {
		let count = data.count / MemoryLayout<Float>.size
		return data.withUnsafeBytes { raw in
			Array(raw.bindMemory(to: Float.self).prefix(count))
		}
	}
}
