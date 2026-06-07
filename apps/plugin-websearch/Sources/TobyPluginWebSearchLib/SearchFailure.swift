import Foundation

public struct SearchFailure: Error, LocalizedError {
	public let message: String

	public init(message: String) {
		self.message = message
	}

	public var errorDescription: String? { message }
}
