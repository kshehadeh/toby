import Foundation
import GRDB

/// The Swift-owned SQLite database (`$TOBY_DIR/app/toby.sqlite`).
public final class TobyDatabase: Sendable {
	public let writer: any DatabaseWriter

	/// Open (creating and migrating) the database at `paths.database`.
	public static func open(paths: TobyPaths) throws -> TobyDatabase {
		try FileManager.default.createDirectory(at: paths.appDirectory, withIntermediateDirectories: true)
		var configuration = Configuration()
		configuration.foreignKeysEnabled = true
		configuration.busyMode = .timeout(5)
		configuration.label = "toby"
		let pool = try DatabasePool(path: paths.database.path, configuration: configuration)
		return try TobyDatabase(writer: pool)
	}

	/// An in-memory database (tests).
	public static func inMemory() throws -> TobyDatabase {
		var configuration = Configuration()
		configuration.foreignKeysEnabled = true
		return try TobyDatabase(writer: DatabaseQueue(configuration: configuration))
	}

	init(writer: any DatabaseWriter) throws {
		self.writer = writer
		try Schema.migrator().migrate(writer)
	}

	/// Row count for a table (diagnostics / import verification).
	public func count(_ table: String) throws -> Int {
		try writer.read { db in
			try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM \(table.quotedDatabaseIdentifier)") ?? 0
		}
	}
}
