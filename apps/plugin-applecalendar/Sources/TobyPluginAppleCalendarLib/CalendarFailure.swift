import Foundation

public struct CalendarFailure: Error, CustomStringConvertible, LocalizedError {
	public let message: String
	public var description: String { message }
	public var errorDescription: String? { message }
	public init(message: String) { self.message = message }
}
