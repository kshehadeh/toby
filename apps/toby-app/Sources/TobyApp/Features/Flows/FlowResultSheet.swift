import SwiftUI

struct FlowResultSheet: View {
	let result: FlowRunNowResponse?
	let onClose: () -> Void

	var body: some View {
		NavigationStack {
			ScrollView {
				VStack(alignment: .leading, spacing: 16) {
					if let result {
						if let extracted = result.result, !extracted.text.isEmpty {
							if extracted.format == "markdown" {
								MarkdownText(
									text: extracted.text,
									font: .body,
									foregroundStyle: SettingsDesign.rowTitle
								)
							} else {
								Text(extracted.text)
									.font(extracted.format == "json" ? .system(.body, design: .monospaced) : .body)
									.foregroundStyle(SettingsDesign.rowTitle)
									.textSelection(.enabled)
							}
						} else {
							Text("The flow finished, but it didn’t produce a text result.")
								.foregroundStyle(SettingsDesign.rowDescription)
						}

						if let destinations = result.destinations, !destinations.isEmpty {
							Divider()
							Text("Delivered")
								.font(.system(size: 13, weight: .semibold))
							ForEach(Array(destinations.enumerated()), id: \.offset) { _, dest in
								HStack {
									Image(systemName: dest.ok ? "checkmark.circle.fill" : "xmark.circle.fill")
										.foregroundStyle(dest.ok ? Color.green : Color.red)
									Text(dest.type.capitalized)
									if let error = dest.error, !error.isEmpty {
										Text(error)
											.foregroundStyle(SettingsDesign.rowDescription)
									}
									Spacer()
								}
								.font(.caption)
							}
						}
					} else {
						ProgressView()
					}
				}
				.padding(24)
				.frame(maxWidth: .infinity, alignment: .leading)
			}
			.background(SettingsDesign.canvasBackground)
			.navigationTitle("Flow result")
			.toolbar {
				ToolbarItem(placement: .cancellationAction) {
					Button("Close", action: onClose)
				}
			}
		}
		.frame(minWidth: 480, minHeight: 360)
	}
}
