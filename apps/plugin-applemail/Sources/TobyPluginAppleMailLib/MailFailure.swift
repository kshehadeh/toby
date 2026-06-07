import Foundation

public struct MailFailure: Error, CustomStringConvertible {
	public let message: String
	public var description: String { message }
	public init(message: String) { self.message = message }
}
