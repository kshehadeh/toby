import Foundation

struct LogFacetBucket: Equatable, Sendable, Identifiable {
	var id: String { name }
	let name: String
	let count: Int
}

struct LogFacets: Equatable, Sendable {
	var sources: [LogFacetBucket]
	var levels: [LogFacetBucket]
	var categories: [LogFacetBucket]
	var types: [LogFacetBucket]

	static let empty = LogFacets(sources: [], levels: [], categories: [], types: [])
}

struct LogsListResponse: Equatable, Sendable {
	let logPath: String
	let entries: [UnifiedLogEntry]
	let limit: Int
	let matched: Int
	let hasMore: Bool
	let facets: LogFacets
}

enum LogsListParser {
	static func parse(_ data: Data) throws -> LogsListResponse {
		guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
			throw TobyClientError.invalidResponse
		}
		guard let logPath = root["logPath"] as? String else {
			throw TobyClientError.invalidResponse
		}
		let limit = root["limit"] as? Int ?? 100
		let matched = root["matched"] as? Int ?? 0
		let hasMore = root["hasMore"] as? Bool ?? false
		let rawEntries = root["entries"] as? [[String: Any]] ?? []
		let entries = rawEntries.enumerated().compactMap { index, obj in
			UnifiedLogEntry.fromAPIObject(obj, index: index)
		}
		let facets = parseFacets(root["facets"] as? [String: Any])
		return LogsListResponse(
			logPath: logPath,
			entries: entries,
			limit: limit,
			matched: matched,
			hasMore: hasMore,
			facets: facets
		)
	}

	private static func parseFacets(_ raw: [String: Any]?) -> LogFacets {
		guard let raw else { return .empty }
		func buckets(_ key: String) -> [LogFacetBucket] {
			guard let list = raw[key] as? [[String: Any]] else { return [] }
			return list.compactMap { item in
				guard let name = item["name"] as? String else { return nil }
				let count = item["count"] as? Int ?? 0
				return LogFacetBucket(name: name, count: count)
			}
		}
		return LogFacets(
			sources: buckets("sources"),
			levels: buckets("levels"),
			categories: buckets("categories"),
			types: buckets("types")
		)
	}
}

extension UnifiedLogEntry {
	/// Build a display entry from a server JSON object (one unified-log line).
	static func fromAPIObject(_ obj: [String: Any], index: Int) -> UnifiedLogEntry? {
		guard let ts = obj["ts"] as? String,
		      let source = obj["source"] as? String,
		      let level = obj["level"] as? String,
		      let category = obj["category"] as? String,
		      let type = obj["type"] as? String
		else { return nil }

		let sessionId = obj["sessionId"] as? String
		let turnIndex = obj["turnIndex"] as? Int

		let message: String?
		let dataPretty: String?
		if var dataDict = obj["data"] as? [String: Any] {
			if let msg = dataDict.removeValue(forKey: "message") {
				if let s = msg as? String {
					message = s
				} else if msg is NSNull {
					message = nil
				} else {
					message = String(describing: msg)
				}
			} else {
				message = nil
			}
			if dataDict.isEmpty {
				dataPretty = nil
			} else if JSONSerialization.isValidJSONObject(dataDict),
			          let prettyData = try? JSONSerialization.data(
			          	withJSONObject: dataDict,
			          	options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
			          ),
			          let pretty = String(data: prettyData, encoding: .utf8)
			{
				dataPretty = pretty
			} else {
				dataPretty = String(describing: dataDict)
			}
		} else if let dataValue = obj["data"],
		          JSONSerialization.isValidJSONObject(dataValue),
		          let prettyData = try? JSONSerialization.data(
		          	withJSONObject: dataValue,
		          	options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
		          ),
		          let pretty = String(data: prettyData, encoding: .utf8)
		{
			message = nil
			dataPretty = pretty
		} else if let dataValue = obj["data"] {
			message = nil
			dataPretty = String(describing: dataValue)
		} else {
			message = nil
			dataPretty = nil
		}

		let id = "\(index)|\(ts)|\(source)|\(type)|\(category)"
		return UnifiedLogEntry(
			id: id,
			ts: ts,
			source: source,
			level: level.lowercased(),
			category: category,
			type: type,
			sessionId: sessionId,
			turnIndex: turnIndex,
			message: message,
			dataPretty: dataPretty
		)
	}
}
