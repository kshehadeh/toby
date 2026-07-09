import SwiftUI
import Testing
import ViewInspector
@testable import TobyApp

@MainActor
@Suite("ServerInfoView")
struct ServerInfoViewTests {
	private func makeStatus(
		version: String = "1.2.3",
		tobyDir: String? = "/Users/example/.toby"
	) -> AppStatus {
		AppStatus(
			version: version,
			persona: "default",
			model: "gpt",
			hasConfiguredAIProvider: nil,
			tobyDir: tobyDir,
			contextWindow: nil,
			personaImageUrl: nil,
			connectedIntegrations: nil,
			personaCount: nil,
			skillCount: nil,
			skills: nil,
			transcription: nil
		)
	}

	private func makeDaemonStatus(
		uptimeSeconds: Int = 3725,
		executablePath: String? = "/usr/local/bin/toby"
	) -> DaemonStatus {
		DaemonStatus(
			process: DaemonProcessInfo(
				pid: 42,
				uptimeSeconds: uptimeSeconds,
				startedAt: nil,
				intervalSeconds: nil,
				logPath: nil,
				webPort: nil,
				executablePath: executablePath
			),
			chatInbound: nil
		)
	}

	private func makePluginsClient(count: Int = 3) -> MockPluginsClient {
		let client = MockPluginsClient()
		client.response = PluginsListResponse(
			directory: "/Users/example/.toby/plugins",
			plugins: (0..<count).map { index in
				PluginSummary(
					name: "plugin-\(index)",
					displayName: "Plugin \(index)",
					description: nil,
					version: "1.0.0",
					protocolVersion: "1",
					icon: nil,
					iconUrl: nil,
					state: "valid",
					connected: true,
					error: nil,
					errorCode: nil
				)
			}
		)
		return client
	}

	@Test("shows title and connection status")
	func showsTitleAndConnection() throws {
		let view = ServerInfoView(
			status: makeStatus(),
			daemonStatus: makeDaemonStatus(),
			health: .connected,
			client: makePluginsClient()
		)
		#expect(throws: Never.self) { try view.inspect().find(text: "Server Info") }
		#expect(throws: Never.self) { try view.inspect().find(text: "Server connected") }
		#expect(throws: Never.self) { try view.inspect().find(text: "Connection") }
	}

	@Test("shows version and uptime")
	func showsVersionAndUptime() throws {
		let view = ServerInfoView(
			status: makeStatus(version: "0.70.0"),
			daemonStatus: makeDaemonStatus(uptimeSeconds: 3725),
			health: .connected,
			client: makePluginsClient()
		)
		#expect(throws: Never.self) { try view.inspect().find(text: "Version") }
		#expect(throws: Never.self) { try view.inspect().find(text: "0.70.0") }
		#expect(throws: Never.self) { try view.inspect().find(text: "Uptime") }
		#expect(throws: Never.self) { try view.inspect().find(text: "1h 2m") }
	}

	@Test("shows home directory and executable paths")
	func showsPaths() throws {
		let view = ServerInfoView(
			status: makeStatus(tobyDir: "/Users/example/.toby"),
			daemonStatus: makeDaemonStatus(executablePath: "/usr/local/bin/toby"),
			health: .connected,
			client: makePluginsClient()
		)
		#expect(throws: Never.self) { try view.inspect().find(text: "Home directory") }
		#expect(throws: Never.self) { try view.inspect().find(text: "Toby home directory") }
		#expect(throws: Never.self) { try view.inspect().find(text: "/Users/example/.toby") }
		#expect(throws: Never.self) { try view.inspect().find(text: "Executable") }
		#expect(throws: Never.self) { try view.inspect().find(text: "Server executable") }
		#expect(throws: Never.self) { try view.inspect().find(text: "/usr/local/bin/toby") }
	}

	@Test("shows offline connection and placeholders when data missing")
	func showsOfflineAndPlaceholders() throws {
		let view = ServerInfoView(
			status: nil,
			daemonStatus: nil,
			health: .offline,
			client: makePluginsClient(count: 0),
			initialPluginCount: 0
		)
		#expect(throws: Never.self) { try view.inspect().find(text: "Server offline") }
		// Multiple "—" placeholders for missing values.
		let dashes = try view.inspect().findAll(ViewType.Text.self).filter {
			(try? $0.string()) == "—"
		}
		#expect(dashes.count >= 2)
		#expect(throws: Never.self) { try view.inspect().find(text: "0 registered") }
	}

	@Test("shows registered plugin count")
	func showsPluginCount() throws {
		let view = ServerInfoView(
			status: makeStatus(),
			daemonStatus: makeDaemonStatus(),
			health: .connected,
			client: makePluginsClient(count: 3),
			initialPluginCount: 3
		)
		#expect(throws: Never.self) { try view.inspect().find(text: "Plugins") }
		#expect(throws: Never.self) { try view.inspect().find(text: "3 registered") }
	}

	@Test("done button calls dismiss callback")
	func doneButtonCallsDismiss() throws {
		var dismissed = false
		let view = ServerInfoView(
			status: makeStatus(),
			daemonStatus: makeDaemonStatus(),
			health: .connected,
			client: makePluginsClient(),
			onDismiss: {
				dismissed = true
			}
		)
		let button = try view.inspect().findAll(ViewType.Button.self).first { btn in
			(try? btn.find(text: "Done")) != nil
		}
		try #require(button != nil, "Done button not found")
		try button!.tap()
		#expect(dismissed)
	}

	@Test("restart button calls restart callback")
	func restartButtonCallsRestart() throws {
		var restartCount = 0
		let view = ServerInfoView(
			status: makeStatus(),
			daemonStatus: makeDaemonStatus(),
			health: .connected,
			client: makePluginsClient(),
			onRestart: { restartCount += 1 }
		)
		let button = try view.inspect().findAll(ViewType.Button.self).first { btn in
			(try? btn.find(text: "Restart server")) != nil
		}
		try #require(button != nil, "Restart server button not found")
		try button!.tap()
		#expect(restartCount == 1)
	}

	@Test("restart button shows restarting state and is disabled")
	func restartButtonShowsRestartingState() throws {
		let view = ServerInfoView(
			status: makeStatus(),
			daemonStatus: makeDaemonStatus(),
			health: .starting,
			isRestarting: true,
			client: makePluginsClient(),
			onRestart: {}
		)
		#expect(throws: Never.self) { try view.inspect().find(text: "Restarting server…") }
		let button = try view.inspect().findAll(ViewType.Button.self).first { btn in
			(try? btn.find(text: "Restarting server…")) != nil
		}
		try #require(button != nil, "Restarting button not found")
		#expect(try button!.isDisabled())
	}

	@Test("formatDaemonUptime formats durations")
	func formatDaemonUptimeFormatsDurations() {
		#expect(formatDaemonUptime(seconds: nil) == "Just started")
		#expect(formatDaemonUptime(seconds: 0) == "Just started")
		#expect(formatDaemonUptime(seconds: 45) == "45s")
		#expect(formatDaemonUptime(seconds: 90) == "1m")
		#expect(formatDaemonUptime(seconds: 3725) == "1h 2m")
	}
}
