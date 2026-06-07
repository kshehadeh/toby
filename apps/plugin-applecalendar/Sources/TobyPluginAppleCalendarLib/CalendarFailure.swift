import Foundation

public struct CalendarFailure: Error, CustomStringConvertible {
	public let message: String
	public var description: String { message }
	public init(message: String) { self.message = message }
}
