import Foundation
import Testing
@testable import TobyApp

@Suite("DaemonBootstrap")
struct DaemonBootstrapTests {
	@Test("keeps server already running from bundled executable")
	func keepsBundledServer() {
		let bundled = URL(fileURLWithPath: "/Applications/Toby.app/Contents/Resources/toby")

		#expect(
			DaemonBootstrap.shouldReplaceServer(
				runningExecutablePath: "/Applications/Toby.app/Contents/Resources/toby",
				runningVersion: "1.2.3",
				runningExecKind: "compiled",
				bundledExecutable: bundled,
				bundledVersion: "1.2.3",
				expectedExecKind: "compiled"
			) == false
		)
	}

	@Test("replaces bundled server running an older version")
	func replacesOlderBundledVersion() {
		let bundled = URL(fileURLWithPath: "/Applications/Toby.app/Contents/Resources/toby")

		#expect(
			DaemonBootstrap.shouldReplaceServer(
				runningExecutablePath: "/Applications/Toby.app/Contents/Resources/toby",
				runningVersion: "1.2.2",
				runningExecKind: "compiled",
				bundledExecutable: bundled,
				bundledVersion: "1.2.3",
				expectedExecKind: "compiled"
			)
		)
	}

	@Test("treats v-prefix version as equal")
	func normalizesVersionPrefix() {
		let bundled = URL(fileURLWithPath: "/Applications/Toby.app/Contents/Resources/toby")

		#expect(
			DaemonBootstrap.shouldReplaceServer(
				runningExecutablePath: "/Applications/Toby.app/Contents/Resources/toby",
				runningVersion: "v1.2.3",
				runningExecKind: "compiled",
				bundledExecutable: bundled,
				bundledVersion: "1.2.3",
				expectedExecKind: "compiled"
			) == false
		)
	}

	@Test("replaces server running from a different executable")
	func replacesDifferentExecutable() {
		let bundled = URL(fileURLWithPath: "/Applications/Toby.app/Contents/Resources/toby")

		#expect(
			DaemonBootstrap.shouldReplaceServer(
				runningExecutablePath: "/Users/dev/toby/apps/cli/src/cli.ts",
				runningVersion: "1.2.3",
				runningExecKind: "source",
				bundledExecutable: bundled,
				bundledVersion: "1.2.3",
				expectedExecKind: "compiled"
			)
		)
	}

	@Test("replaces when exec kind differs even if path is unknown")
	func replacesDifferentExecKind() {
		#expect(
			DaemonBootstrap.shouldReplaceServer(
				runningExecutablePath: nil,
				runningVersion: "1.2.3",
				runningExecKind: "source",
				bundledExecutable: nil,
				bundledVersion: "1.2.3",
				expectedExecKind: "compiled"
			)
		)
	}

	@Test("replaces server when executable path is missing")
	func replacesMissingExecutablePath() {
		let bundled = URL(fileURLWithPath: "/Applications/Toby.app/Contents/Resources/toby")

		#expect(
			DaemonBootstrap.shouldReplaceServer(
				runningExecutablePath: nil,
				runningVersion: nil,
				bundledExecutable: bundled,
				bundledVersion: "1.2.3",
				expectedExecKind: "compiled"
			)
		)
	}

	@Test("restart candidates prefer current directory toby")
	func restartCandidatesPreferCurrentDirectory() {
		let current = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
			.appendingPathComponent("toby")

		#expect(DaemonBootstrap.executableCandidates(preferCurrentDirectory: true).first == current)
	}

	@Test("restart candidates include current directory dist toby")
	func restartCandidatesIncludeCurrentDirectoryDistToby() {
		let dist = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
			.appendingPathComponent("dist/toby")

		let candidates = DaemonBootstrap.executableCandidates(preferCurrentDirectory: true)
		#expect(candidates.contains(dist))
		#expect(candidates.firstIndex(of: dist)! < candidates.firstIndex(of: URL(fileURLWithPath: "/opt/homebrew/bin/toby"))!)
	}

	@Test("default candidates do not prepend current directory toby")
	func defaultCandidatesDoNotPrependCurrentDirectory() {
		let current = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
			.appendingPathComponent("toby")

		#expect(DaemonBootstrap.executableCandidates(preferCurrentDirectory: false).first != current)
	}

	@Test("dev restart commands prefer bun source cli")
	func devRestartCommandsPreferBunSourceCli() throws {
		let commands = DaemonBootstrap.daemonStartCommands(preferDevSource: true)
		let command = try #require(commands.first)

		#expect(command.arguments.contains("daemon"))
		#expect(command.arguments.contains("start"))
		#expect(command.arguments.contains { $0.hasSuffix("apps/cli/src/cli.ts") })
		#expect(command.currentDirectoryURL?.appendingPathComponent("apps/cli/src/cli.ts").path(percentEncoded: false) == command.arguments.first { $0.hasSuffix("apps/cli/src/cli.ts") })
	}

	@Test("dev start commands do not use env bun fallback")
	func devStartCommandsDoNotUseEnvBunFallback() {
		let commands = DaemonBootstrap.daemonStartCommands(preferDevSource: true)

		#expect(!commands.contains { $0.executableURL.path == "/usr/bin/env" && $0.arguments.first == "bun" })
	}

	@Test("default restart commands use compiled cli")
	func defaultRestartCommandsUseCompiledCli() throws {
		let commands = DaemonBootstrap.daemonStartCommands(preferDevSource: false)
		let command = try #require(commands.first)

		#expect(command.arguments == ["daemon", "start"])
		#expect(command.currentDirectoryURL == nil)
	}

	@Test("preferred start command prefers bundled binary when present")
	func preferredStartUsesBundledWhenAvailable() throws {
		// In test host, bundle may or may not include Resources/toby.
		// When no bundle CLI exists, preferred resolution must still return a command.
		let command = try DaemonBootstrap.resolvePreferredDaemonStartCommand()
		#expect(command.arguments.contains("daemon"))
		#expect(command.arguments.contains("start"))
		if DaemonBootstrap.hasBundledTobyExecutable() {
			#expect(command.arguments == ["daemon", "start"])
			#expect(command.currentDirectoryURL == nil)
		}
	}
}
