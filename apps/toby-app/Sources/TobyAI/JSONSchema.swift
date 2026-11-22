import Foundation

/// A JSON Schema used for tool parameters and structured output.
///
/// Builders produce schemas that satisfy OpenAI-style *strict* mode
/// (`additionalProperties: false`, every property listed in `required`;
/// optional properties are expressed as nullable unions).
public struct JSONSchema: Sendable, Hashable {
	public var value: JSONValue

	public init(_ value: JSONValue) {
		self.value = value
	}

	public static func string(
		description: String? = nil,
		enum values: [String]? = nil,
		nullable: Bool = false,
	) -> JSONSchema {
		var dict: [String: JSONValue] = ["type": nullable ? JSONValue.array(["string", "null"]) : JSONValue.string("string")]
		if let description { dict["description"] = .string(description) }
		if let values { dict["enum"] = .array(values.map { JSONValue.string($0) } + (nullable ? [JSONValue.null] : [])) }
		return JSONSchema(.object(dict))
	}

	public static func number(description: String? = nil, nullable: Bool = false) -> JSONSchema {
		primitive("number", description: description, nullable: nullable)
	}

	public static func integer(description: String? = nil, nullable: Bool = false) -> JSONSchema {
		primitive("integer", description: description, nullable: nullable)
	}

	public static func boolean(description: String? = nil, nullable: Bool = false) -> JSONSchema {
		primitive("boolean", description: description, nullable: nullable)
	}

	public static func array(
		_ items: JSONSchema,
		description: String? = nil,
		nullable: Bool = false,
	) -> JSONSchema {
		var dict: [String: JSONValue] = [
			"type": nullable ? JSONValue.array(["array", "null"]) : JSONValue.string("array"),
			"items": items.value,
		]
		if let description { dict["description"] = .string(description) }
		return JSONSchema(.object(dict))
	}

	/// An object schema. Properties not in `optional` are required; optional ones
	/// are still listed in `required` (strict mode) but made nullable.
	public static func object(
		_ properties: KeyValuePairs<String, JSONSchema>,
		optional: Set<String> = [],
		description: String? = nil,
		nullable: Bool = false,
	) -> JSONSchema {
		var props: [String: JSONValue] = [:]
		var order: [JSONValue] = []
		for (key, schema) in properties {
			props[key] = optional.contains(key) ? schema.makingNullable().value : schema.value
			order.append(.string(key))
		}
		var dict: [String: JSONValue] = [
			"type": nullable ? JSONValue.array(["object", "null"]) : JSONValue.string("object"),
			"properties": .object(props),
			"required": .array(order),
			"additionalProperties": false,
		]
		if let description { dict["description"] = .string(description) }
		return JSONSchema(.object(dict))
	}

	/// The empty-object schema for tools with no parameters.
	public static var empty: JSONSchema {
		JSONSchema([
			"type": "object",
			"properties": [:],
			"required": [],
			"additionalProperties": false,
		])
	}

	/// Return a copy whose `type` also admits `null`.
	public func makingNullable() -> JSONSchema {
		guard case var .object(dict) = value else { return self }
		switch dict["type"] {
		case let .string(type):
			dict["type"] = [.string(type), "null"]
		case let .array(types) where !types.contains(.null):
			dict["type"] = .array(types + [.null])
		default:
			break
		}
		if case let .array(values) = dict["enum"], !values.contains(.null) {
			dict["enum"] = .array(values + [.null])
		}
		return JSONSchema(.object(dict))
	}

	private static func primitive(_ type: String, description: String?, nullable: Bool) -> JSONSchema {
		var dict: [String: JSONValue] = ["type": nullable ? JSONValue.array([.string(type), "null"]) : JSONValue.string(type)]
		if let description { dict["description"] = .string(description) }
		return JSONSchema(.object(dict))
	}
}
