import SwiftUI

struct ServerInfoView: View {
	let status: AppStatus?
	let daemonStatus: DaemonStatus?
	let health: ServerHealth
	let isRestarting: Bool
	var lifecycleMessage: String? = nil
	var client: PluginsFetchable = TobyClient()
	var onRestart: (() -> Void)? = nil
	var onDismiss: (() -> Void)? = nil

	@State private var pluginCount: Int?
	@State private var isLoadingPlugins = false
	@State private var pluginError: String?

	init(
		status: AppStatus?,
		daemonStatus: DaemonStatus?,
		health: ServerHealth,
		isRestarting: Bool = false,
		lifecycleMessage: String? = nil,
		client: PluginsFetchable = TobyClient(),
		initialPluginCount: Int? = nil,
		onRestart: (() -> Void)? = nil,
		onDismiss: (() -> Void)? = nil
	) {
		self.status = status
		self.daemonStatus = daemonStatus
		self.health = health
		self.isRestarting = isRestarting
		self.lifecycleMessage = lifecycleMessage
		self.client = client
		self.onRestart = onRestart
		self.onDismiss = onDismiss
		_pluginCount = State(initialValue: initialPluginCount)
	}

	var body: some View {
		VStack(spacing: 0) {
			header
				.padding(.horizontal, 20)
				.padding(.top, 20)
				.padding(.bottom, 12)

			Divider()
				.background(AppTheme.separator)

			ScrollView {
				VStack(alignment: .leading, spacing: 16) {
					connectionRow
					if isRestarting, let lifecycleMessage, !lifecycleMessage.isEmpty {
						infoRow(title: "Status", value: lifecycleMessage)
					}
					infoRow(title: "Version", value: status?.version)
					infoRow(title: "Uptime", value: formatDaemonUptime(seconds: daemonStatus?.process?.uptimeSeconds))
					pathRow(
						title: "Home directory",
						path: status?.tobyDir,
						revealLabel: "Toby home directory"
					)
					pathRow(
						title: "Executable",
						path: daemonStatus?.process?.executablePath,
						revealLabel: "Server executable"
					)
					pluginsRow
				}
				.padding(20)
				.frame(maxWidth: .infinity, alignment: .leading)
			}

			Divider()
				.background(AppTheme.separator)

			HStack(spacing: 12) {
				Button {
					onRestart?()
				} label: {
					Label {
						Text(isRestarting ? "Restarting server…" : "Restart server")
					} icon: {
						if isRestarting {
							ProgressView()
								.controlSize(.small)
						} else {
							Image(systemName: "arrow.clockwise")
						}
					}
				}
				.buttonStyle(.bordered)
				.disabled(isRestarting || onRestart == nil)
				.accessibilityLabel(isRestarting ? "Restarting server" : "Restart server")

				Spacer(minLength: 0)

				Button("Done") {
					onDismiss?()
				}
				.keyboardShortcut(.defaultAction)
				.accessibilityLabel("Close server info")
			}
			.padding(.horizontal, 20)
			.padding(.vertical, 14)
		}
		.frame(width: 440, height: 420)
		.background(AppTheme.contentBackground)
		.task {
			await loadPlugins()
		}
	}

	private var header: some View {
		HStack(spacing: 10) {
			Image(systemName: "server.rack")
				.font(.title2)
				.foregroundStyle(AppTheme.accent)
				.accessibilityHidden(true)
			Text("Server Info")
				.font(.title2.weight(.semibold))
				.foregroundStyle(AppTheme.primaryText)
			Spacer(minLength: 0)
		}
		.accessibilityElement(children: .combine)
		.accessibilityAddTraits(.isHeader)
	}

	private var connectionRow: some View {
		HStack(alignment: .firstTextBaseline) {
			Text("Connection")
				.font(.callout)
				.foregroundStyle(AppTheme.secondaryText)
				.frame(width: 120, alignment: .leading)
			HStack(spacing: 6) {
				Circle()
					.fill(health.color)
					.frame(width: 8, height: 8)
				Text(health.displayLabel(lifecycleMessage: lifecycleMessage))
					.font(.callout.weight(.medium))
					.foregroundStyle(AppTheme.primaryText)
				if isRestarting {
					ProgressView()
						.controlSize(.small)
				}
			}
			Spacer(minLength: 0)
		}
		.accessibilityElement(children: .combine)
		.accessibilityLabel("Connection, \(health.displayLabel(lifecycleMessage: lifecycleMessage))")
	}

	private var pluginsRow: some View {
		HStack(alignment: .firstTextBaseline) {
			Text("Plugins")
				.font(.callout)
				.foregroundStyle(AppTheme.secondaryText)
				.frame(width: 120, alignment: .leading)
			Group {
				if isLoadingPlugins && pluginCount == nil {
					Text("Loading…")
						.font(.callout)
						.foregroundStyle(AppTheme.tertiaryText)
				} else if let pluginError {
					Text(pluginError)
						.font(.callout)
						.foregroundStyle(.red)
						.fixedSize(horizontal: false, vertical: true)
				} else if let pluginCount {
					Text(pluginCount == 1 ? "1 registered" : "\(pluginCount) registered")
						.font(.callout)
						.foregroundStyle(AppTheme.primaryText)
						.textSelection(.enabled)
				} else {
					Text("—")
						.font(.callout)
						.foregroundStyle(AppTheme.tertiaryText)
				}
			}
			Spacer(minLength: 0)
		}
		.accessibilityElement(children: .combine)
	}

	@ViewBuilder
	private func infoRow(title: String, value: String?) -> some View {
		HStack(alignment: .firstTextBaseline) {
			Text(title)
				.font(.callout)
				.foregroundStyle(AppTheme.secondaryText)
				.frame(width: 120, alignment: .leading)
			Text(displayValue(value))
				.font(.callout)
				.foregroundStyle(value == nil || value?.isEmpty == true ? AppTheme.tertiaryText : AppTheme.primaryText)
				.textSelection(.enabled)
			Spacer(minLength: 0)
		}
		.accessibilityElement(children: .combine)
		.accessibilityLabel("\(title), \(displayValue(value))")
	}

	@ViewBuilder
	private func pathRow(title: String, path: String?, revealLabel: String) -> some View {
		VStack(alignment: .leading, spacing: 6) {
			Text(title)
				.font(.callout)
				.foregroundStyle(AppTheme.secondaryText)
			if let path, !path.isEmpty {
				RevealPathButton(path: path, label: revealLabel)
			} else {
				Text("—")
					.font(.callout)
					.foregroundStyle(AppTheme.tertiaryText)
			}
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	private func displayValue(_ value: String?) -> String {
		guard let value, !value.isEmpty else { return "—" }
		return value
	}

	private func loadPlugins() async {
		isLoadingPlugins = true
		pluginError = nil
		defer { isLoadingPlugins = false }
		do {
			let response = try await client.fetchPlugins()
			pluginCount = response.plugins.count
		} catch {
			pluginError = error.localizedDescription
			pluginCount = nil
		}
	}
}

func formatDaemonUptime(seconds: Int?) -> String {
	guard let seconds, seconds > 0 else {
		return "Just started"
	}
	let minutes = seconds / 60
	let hours = minutes / 60
	let remainingMinutes = minutes % 60
	if hours > 0 {
		return "\(hours)h \(remainingMinutes)m"
	}
	if minutes > 0 {
		return "\(minutes)m"
	}
	return "\(seconds)s"
}
