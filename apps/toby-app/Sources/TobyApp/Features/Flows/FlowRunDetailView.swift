import SwiftUI

struct FlowRunDetailView: View {
	@Environment(\.dismiss) private var dismiss
	let run: FlowRunDetail?
	let isLoading: Bool
	let error: String?

	var body: some View {
		NavigationStack {
			ScrollView {
				VStack(alignment: .leading, spacing: 20) {
					if isLoading && run == nil {
						ProgressView("Loading run…")
							.frame(maxWidth: .infinity, minHeight: 200)
					} else if let error, run == nil {
						ContentUnavailableView {
							Label("Run unavailable", systemImage: "exclamationmark.triangle")
						} description: {
							Text(error)
						}
					} else if let run {
						runContent(run)
					}
				}
				.frame(maxWidth: SettingsDesign.contentMaxWidth)
				.frame(maxWidth: .infinity)
				.padding(.horizontal, 24)
				.padding(.vertical, 20)
			}
			.background(SettingsDesign.canvasBackground)
			.navigationTitle(titleText)
			.toolbar {
				ToolbarItem(placement: .cancellationAction) {
					Button("Close") {
						dismiss()
					}
				}
			}
		}
		.frame(minWidth: 560, minHeight: 420)
	}

	private var titleText: String {
		guard let run else { return "Flow run" }
		return "\(FlowListItem.humanizeFlowId(run.flowName)) · \(run.displayStatus)"
	}

	@ViewBuilder
	private func runContent(_ run: FlowRunDetail) -> some View {
		VStack(alignment: .leading, spacing: 20) {
			HStack(spacing: 12) {
				RoundedRectangle(cornerRadius: 10)
					.fill(run.statusColor.opacity(0.18))
					.frame(width: 40, height: 40)
					.overlay {
						Image(systemName: run.statusIcon)
							.font(.system(size: 18))
							.foregroundStyle(run.statusColor)
					}
				VStack(alignment: .leading, spacing: 2) {
					Text(run.displayStatus)
						.font(.headline)
						.foregroundStyle(AppTheme.primaryText)
					Text(run.startedLabel)
						.font(.caption)
						.foregroundStyle(AppTheme.tertiaryText)
				}
				Spacer()
				Text(run.durationLabel)
					.font(.caption.weight(.medium))
					.foregroundStyle(AppTheme.secondaryText)
			}

			if let error = run.error, !error.isEmpty {
				section(title: "Error") {
					InlineStatusMessage(
						message: error,
						tone: .error,
						font: .body,
						allowsTextSelection: true
					)
				}
			}

			section(title: "Metadata") {
				VStack(alignment: .leading, spacing: 8) {
					metaRow("Flow", run.flowName)
					metaRow("Trigger", run.trigger ?? "—")
					metaRow("Persona", run.personaName ?? "—")
					metaRow("Provider", run.provider ?? "—")
					metaRow("Model", run.model ?? "—")
					if let failedNodeId = run.failedNodeId {
						metaRow("Failed node", failedNodeId)
					}
					metaRow("Run ID", run.id)
				}
			}

			if let initialInputs = run.initialInputs {
				section(title: "Initial inputs") {
					jsonBlock(initialInputs.prettyPrinted())
				}
			}

			if let finalOutputs = run.finalOutputs {
				section(title: "Final outputs") {
					jsonBlock(finalOutputs.prettyPrinted())
				}
			}

			section(title: "Nodes") {
				if run.nodes.isEmpty {
					Text("No node records for this run.")
						.font(.caption)
						.foregroundStyle(SettingsDesign.rowDescription)
				} else {
					VStack(alignment: .leading, spacing: 12) {
						ForEach(run.nodes) { node in
							FlowRunNodeBlock(node: node)
						}
					}
				}
			}
		}
	}

	private func section<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
		VStack(alignment: .leading, spacing: 8) {
			Text(title)
				.font(.system(size: 13, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			content()
				.padding(SettingsDesign.rowHorizontalPadding)
				.padding(.vertical, SettingsDesign.rowVerticalPadding)
				.frame(maxWidth: .infinity, alignment: .leading)
				.background(
					RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
						.fill(SettingsDesign.cardBackground)
				)
				.overlay(
					RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
						.stroke(SettingsDesign.cardBorder, lineWidth: 1)
				)
		}
	}

	private func metaRow(_ label: String, _ value: String) -> some View {
		HStack(alignment: .top) {
			Text(label)
				.font(.system(size: 12))
				.foregroundStyle(SettingsDesign.rowDescription)
				.frame(width: 100, alignment: .leading)
			Text(value)
				.font(.system(size: 12, design: .monospaced))
				.foregroundStyle(SettingsDesign.rowTitle)
				.textSelection(.enabled)
				.frame(maxWidth: .infinity, alignment: .leading)
		}
	}

	private func jsonBlock(_ text: String) -> some View {
		Text(text)
			.font(.system(size: 11, design: .monospaced))
			.foregroundStyle(SettingsDesign.rowTitle)
			.frame(maxWidth: .infinity, alignment: .leading)
			.textSelection(.enabled)
	}
}

private struct FlowRunNodeBlock: View {
	let node: FlowRunNodeDetail
	@State private var isExpanded = false

	var body: some View {
		VStack(alignment: .leading, spacing: 8) {
			Button {
				withAnimation(.easeOut(duration: 0.15)) {
					isExpanded.toggle()
				}
			} label: {
				HStack(spacing: 8) {
					Circle()
						.fill(node.statusColor)
						.frame(width: 8, height: 8)
					Text(node.nodeId)
						.font(.system(size: 12, weight: .semibold))
						.foregroundStyle(SettingsDesign.rowTitle)
					Text(node.typeLabel)
						.font(.system(size: 11))
						.foregroundStyle(AppTheme.tertiaryText)
					Spacer()
					Text(node.durationLabel)
						.font(.system(size: 11))
						.foregroundStyle(AppTheme.secondaryText)
					Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
						.font(.system(size: 10, weight: .semibold))
						.foregroundStyle(AppTheme.tertiaryText)
				}
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)

			if isExpanded {
				VStack(alignment: .leading, spacing: 8) {
					if let error = node.error, !error.isEmpty {
						InlineStatusMessage(
							message: error,
							tone: .error,
							font: .system(size: 11),
							allowsTextSelection: true
						)
					}
					if let inputs = node.inputs {
						labeledJSON("Inputs", inputs.prettyPrinted())
					}
					if let outputs = node.outputs {
						labeledJSON("Outputs", outputs.prettyPrinted())
					}
					if let detail = node.detail {
						labeledJSON("Detail", detail.prettyPrinted())
					}
				}
				.padding(.leading, 16)
			}
		}
		.padding(.vertical, 4)
	}

	private func labeledJSON(_ label: String, _ text: String) -> some View {
		VStack(alignment: .leading, spacing: 4) {
			Text(label)
				.font(.system(size: 11, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowDescription)
			Text(text)
				.font(.system(size: 10, design: .monospaced))
				.foregroundStyle(SettingsDesign.rowTitle)
				.textSelection(.enabled)
				.frame(maxWidth: .infinity, alignment: .leading)
		}
	}
}
