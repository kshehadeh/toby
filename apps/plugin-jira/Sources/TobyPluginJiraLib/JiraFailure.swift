import Foundation

public struct JiraFailure: Error, CustomStringConvertible, LocalizedError {
	public let message: String
	public var description: String { message }
	public var errorDescription: String? { message }
	public init(message: String) { self.message = message }
}
