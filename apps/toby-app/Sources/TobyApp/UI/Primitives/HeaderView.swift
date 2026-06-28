import SwiftUI

struct HeaderView: View {
	let status: AppStatus?
	let sessionName: String

	private let titleLines = [
		"████████╗ ██████╗ ██████╗ ██╗   ██╗",
		"╚══██╔══╝██╔═══██╗██╔══██╗╚██╗ ██╔╝",
		"   ██║   ██║   ██║██████╔╝ ╚████╔╝ ",
		"   ██║   ██║   ██║██╔══██╗  ╚██╔╝  ",
		"   ██║   ╚██████╔╝██████╔╝   ██║   ",
		"   ╚═╝    ╚═════╝ ╚═════╝    ╚═╝   ",
	]

	var body: some View {
		VStack(spacing: 6) {
			ForEach(titleLines, id: \.self) { line in
				Text(line)
					.font(.system(.caption, design: .monospaced))
					.foregroundStyle(Color(red: 0.63, green: 0.38, blue: 0.03))
			}
			if let status {
				Text("v\(status.version)")
					.font(.caption)
					.foregroundStyle(.secondary)
				Text(subheader(for: status))
					.font(.caption)
					.foregroundStyle(.secondary)
					.multilineTextAlignment(.center)
			}
			Text(sessionName)
				.font(.headline)
				.padding(.top, 4)
		}
		.frame(maxWidth: .infinity)
		.padding(.vertical, 12)
	}

	private func subheader(for status: AppStatus) -> String {
		let integrations = status.connectedIntegrations ?? []
		let integrationText =
			integrations.isEmpty
				? "No integrations connected"
				: integrations.joined(separator: ", ")
		let skills = status.skillCount.map { "\($0) skill\($0 == 1 ? "" : "s")" } ?? ""
		let parts = [status.persona, status.model, integrationText, skills].filter { !$0.isEmpty }
		return parts.joined(separator: " · ")
	}
}
