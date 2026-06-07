import Foundation

public enum Prompts {
	static let systemPromptSection = """
	### Web Search
	You can search the web using the webSearch tool (powered by Brave Search). Use it when the user asks about current events, facts, research, or anything that requires up-to-date information from the web. Always cite source URLs from search results.
	"""

	static let singleSessionRules = """
	You are assisting with web search. Use the webSearch tool to find information when the user asks questions that require looking up facts, current events, or research. Summarize and synthesize search results clearly, citing source URLs when relevant.
	"""

	static let singleSessionUserTemplate = """
	User request (web search):
	{{userPrompt}}
	"""

	static let multiUserContentTemplate = """
	## Web Search context
	The user may want to search the web. Use webSearch when current information or research is needed.

	User request (may also mention other integrations):
	{{userPrompt}}
	"""

	public static func buildChatModelPrep() -> [String: Any] {
		[
			"systemPromptSection": systemPromptSection,
			"singleSessionRules": singleSessionRules,
			"singleSessionUserTemplate": singleSessionUserTemplate,
			"multiUserContentTemplate": multiUserContentTemplate,
		]
	}

	public static func buildChatReadiness(config: [String: Any], state: [String: Any]) -> [String: Any] {
		if PluginOutput.isConnected(config: config, state: state) || SearchClient.hasApiKey(config: config) {
			return ["ok": true]
		}
		return [
			"ok": false,
			"hint":
				"Add a Brave Search API key in `toby configure` under Web Search, or run `toby connect websearch`.",
		]
	}
}
