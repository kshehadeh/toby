import Foundation

extension KeyedDecodingContainer {
	func decodePreferredString(
		forKey primaryKey: Key,
		fallingBackTo fallbackKey: Key
	) throws -> String {
		let primary = try decodeIfPresent(String.self, forKey: primaryKey) ?? ""
		if !primary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
			return primary
		}
		return try decodeIfPresent(String.self, forKey: fallbackKey) ?? ""
	}
}
