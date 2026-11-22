import Foundation

/// A type-erased, `Sendable` JSON value used for tool arguments/results,
/// request bodies, and anything else that crosses the model boundary.
public enum JSONValue: Sendable, Hashable, Codable {
	case null
	case bool(Bool)
	case number(Double)
	case string(String)
	case array([JSONValue])
	case object([String: JSONValue])

	public init(from decoder: Decoder) throws {
		let container = try decoder.singleValueContainer()
		if container.decodeNil() {
			self = .null
		} else if let value = try? container.decode(Bool.self) {
			self = .bool(value)
		} else if let value = try? container.decode(Double.self) {
			self = .number(value)
		} else if let value = try? container.decode(String.self) {
			self = .string(value)
		} else if let value = try? container.decode([JSONValue].self) {
			self = .array(value)
		} else if let value = try? container.decode([String: JSONValue].self) {
			self = .object(value)
		} else {
			throw DecodingError.dataCorruptedError(
				in: container,
				debugDescription: "Unsupported JSON value",
			)
		}
	}

	public func encode(to encoder: Encoder) throws {
		var container = encoder.singleValueContainer()
		switch self {
		case .null: try container.encodeNil()
		case let .bool(value): try container.encode(value)
		case let .number(value):
			if value.rounded() == value, abs(value) < 1e15 {
				try container.encode(Int64(value))
			} else {
				try container.encode(value)
			}
		case let .string(value): try container.encode(value)
		case let .array(value): try container.encode(value)
		case let .object(value): try container.encode(value)
		}
	}

	// MARK: Accessors

	public subscript(key: String) -> JSONValue? {
		if case let .object(dict) = self { return dict[key] }
		return nil
	}

	public subscript(index: Int) -> JSONValue? {
		if case let .array(items) = self, items.indices.contains(index) { return items[index] }
		return nil
	}

	public var stringValue: String? {
		if case let .string(value) = self { return value }
		return nil
	}

	public var doubleValue: Double? {
		if case let .number(value) = self { return value }
		return nil
	}

	public var intValue: Int? {
		if case let .number(value) = self { return Int(value) }
		return nil
	}

	public var boolValue: Bool? {
		if case let .bool(value) = self { return value }
		return nil
	}

	public var arrayValue: [JSONValue]? {
		if case let .array(value) = self { return value }
		return nil
	}

	public var objectValue: [String: JSONValue]? {
		if case let .object(value) = self { return value }
		return nil
	}

	public var isNull: Bool {
		if case .null = self { return true }
		return false
	}

	// MARK: Conversion

	/// Encode any `Encodable` into a `JSONValue`.
	public init(encoding value: some Encodable) throws {
		let data = try JSONEncoder.toby.encode(value)
		self = try JSONDecoder().decode(JSONValue.self, from: data)
	}

	/// Parse JSON text.
	public init(parsing text: String) throws {
		self = try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
	}

	/// Decode this value into a `Decodable` type.
	public func decode<T: Decodable>(as type: T.Type = T.self) throws -> T {
		let data = try JSONEncoder.toby.encode(self)
		return try JSONDecoder().decode(T.self, from: data)
	}

	/// Compact JSON text (sorted keys for determinism).
	public func jsonString() -> String {
		guard let data = try? JSONEncoder.toby.encode(self) else { return "null" }
		return String(decoding: data, as: UTF8.self)
	}
}

extension JSONValue: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral,
	ExpressibleByFloatLiteral, ExpressibleByBooleanLiteral, ExpressibleByArrayLiteral,
	ExpressibleByDictionaryLiteral, ExpressibleByNilLiteral
{
	public init(stringLiteral value: String) { self = .string(value) }
	public init(integerLiteral value: Int) { self = .number(Double(value)) }
	public init(floatLiteral value: Double) { self = .number(value) }
	public init(booleanLiteral value: Bool) { self = .bool(value) }
	public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
	public init(dictionaryLiteral elements: (String, JSONValue)...) {
		self = .object(Dictionary(elements, uniquingKeysWith: { _, last in last }))
	}

	public init(nilLiteral _: ()) { self = .null }
}

extension JSONEncoder {
	/// Shared encoder configuration: sorted keys, no slash escaping.
	static var toby: JSONEncoder {
		let encoder = JSONEncoder()
		encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
		return encoder
	}
}
