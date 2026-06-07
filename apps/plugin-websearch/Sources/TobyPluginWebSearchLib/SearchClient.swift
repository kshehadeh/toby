import Foundation

public enum SearchClient {
	private static let apiBase = "https://api.search.brave.com/res/v1/web/search"

	public static func hasApiKey(config: [String: Any]) -> Bool {
		apiKey(from: config) != nil
	}

	public static func apiKey(from config: [String: Any]) -> String? {
		guard let key = stringValue(config["apiKey"])?.trimmingCharacters(in: .whitespacesAndNewlines),
			!key.isEmpty
		else {
			return nil
		}
		return key
	}

	public static func testConnection(config: [String: Any]) throws {
		_ = try webSearch(config: config, query: "test", count: 1)
	}

	public static func webSearch(
		config: [String: Any],
		query: String,
		count: Int = 10,
		freshness: String? = nil,
		offset: Int? = nil
	) throws -> [String: Any] {
		guard let apiKey = apiKey(from: config) else {
			throw SearchFailure(
				message:
					"Brave Search API key not found. Add it in `toby configure` under Web Search."
			)
		}

		var components = URLComponents(string: apiBase)
		var queryItems = [
			URLQueryItem(name: "q", value: query),
			URLQueryItem(name: "count", value: String(max(1, min(count, 20)))),
		]
		if let freshness, !freshness.isEmpty {
			queryItems.append(URLQueryItem(name: "freshness", value: freshness))
		}
		if let offset, offset > 0 {
			queryItems.append(URLQueryItem(name: "offset", value: String(offset)))
		}
		components?.queryItems = queryItems

		guard let url = components?.url else {
			throw SearchFailure(message: "Invalid Brave Search URL.")
		}

		var request = URLRequest(url: url)
		request.httpMethod = "GET"
		request.setValue(apiKey, forHTTPHeaderField: "X-Subscription-Token")
		request.setValue("application/json", forHTTPHeaderField: "Accept")
		request.timeoutInterval = 15

		let (data, response) = try syncData(for: request)
		guard let http = response as? HTTPURLResponse else {
			throw SearchFailure(message: "Brave Search API returned an invalid response.")
		}

		if http.statusCode < 200 || http.statusCode >= 300 {
			let body = String(data: data, encoding: .utf8) ?? ""
			throw SearchFailure(
				message:
					"Brave Search API returned HTTP \(http.statusCode): \(String(body.prefix(200)))"
			)
		}

		let json = try parseJSONObject(data)
		let rawResults = ((json["web"] as? [String: Any])?["results"] as? [[String: Any]]) ?? []
		let results = rawResults.map { item -> [String: Any] in
			var result: [String: Any] = [
				"title": stringValue(item["title"]) ?? "",
				"url": stringValue(item["url"]) ?? "",
				"description": stringValue(item["description"]) ?? "",
			]
			if let pageAge = stringValue(item["page_age"]), !pageAge.isEmpty {
				result["pageAge"] = pageAge
			}
			return result
		}

		return [
			"ok": true,
			"query": query,
			"results": results,
		]
	}

	public static func validateTools(config: [String: Any]) -> [[String: Any]] {
		do {
			_ = try webSearch(config: config, query: "test", count: 1)
			return [[
				"tool": "webSearch",
				"ok": true,
				"details": "Brave Search API responded successfully.",
			]]
		} catch {
			return [[
				"tool": "webSearch",
				"ok": true,
				"details": "Tool is available but API test failed (credentials may be invalid).",
			]]
		}
	}

	private static func syncData(for request: URLRequest) throws -> (Data, URLResponse) {
		let semaphore = DispatchSemaphore(value: 0)
		var result: Result<(Data, URLResponse), Error>?
		let task = URLSession.shared.dataTask(with: request) { data, response, error in
			if let error {
				result = .failure(error)
			} else if let data, let response {
				result = .success((data, response))
			} else {
				result = .failure(SearchFailure(message: "Brave Search API returned no data."))
			}
			semaphore.signal()
		}
		task.resume()
		semaphore.wait()
		switch result {
		case let .success(payload):
			return payload
		case let .failure(error):
			throw error
		case .none:
			throw SearchFailure(message: "Brave Search API request failed.")
		}
	}

	private static func parseJSONObject(_ data: Data) throws -> [String: Any] {
		let object = try JSONSerialization.jsonObject(with: data)
		guard let json = object as? [String: Any] else {
			throw SearchFailure(message: "Brave Search API returned invalid JSON.")
		}
		return json
	}

	private static func stringValue(_ value: Any?) -> String? {
		if let s = value as? String { return s }
		if let n = value as? NSNumber { return n.stringValue }
		return nil
	}
}
