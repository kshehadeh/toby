import Foundation

enum HelperError: Error, CustomStringConvertible {
	case usage(String)
	case permission(String)
	case runtime(String)
	case unsupported(String)

	var description: String {
		switch self {
		case let .usage(m), let .permission(m), let .runtime(m), let .unsupported(m):
			return m
		}
	}
}

struct ArgParser {
	let args: [String]
	var index: Int = 0

	var isExhausted: Bool { index >= args.count }

	mutating func next() -> String? {
		guard index < args.count else { return nil }
		let val = args[index]
		index += 1
		return val
	}

	mutating func nextRequired(_ label: String) throws -> String {
		guard let val = next() else {
			throw HelperError.usage("\(label) requires a value")
		}
		return val
	}

	mutating func parseFlag(_ name: String) -> Bool {
		if index < args.count && args[index] == name {
			index += 1
			return true
		}
		return false
	}

	mutating func parseValue(_ name: String) -> String? {
		if index < args.count && args[index] == name {
			index += 1
			return next()
		}
		return nil
	}
}
