import SwiftUI

enum FlowDetailTab: String, Hashable, CaseIterable {
	case details
	case recentRuns
}

struct FlowDetailContent: View {
	@Bindable var store: FlowsStore
	let flow: FlowListItem

	var body: some View {
		TabView(selection: $store.selectedDetailTab) {
			Tab(value: FlowDetailTab.details) {
				FlowDetailsPane(store: store, flow: flow)
			} label: {
				Text("Details")
			}
			Tab(value: FlowDetailTab.recentRuns) {
				FlowRecentRunsPane(store: store)
			} label: {
				Text("Recent runs")
			}
		}
		.padding(AppTheme.contentPadding)
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(SettingsDesign.canvasBackground)
		.accessibilityIdentifier("flow-detail-tabs")
	}
}

struct FlowDetailsPane: View {
	@Bindable var store: FlowsStore
	let flow: FlowListItem

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 22) {
				if let description = flow.description, !description.isEmpty {
					DetailSection(title: "Description") {
						Text(description)
							.font(.body)
							.foregroundStyle(SettingsDesign.rowTitle)
							.frame(maxWidth: .infinity, alignment: .leading)
							.fixedSize(horizontal: false, vertical: true)
					}
				}

				DetailSection(title: "Steps") {
					FlowNodePipeline(nodes: flow.nodes)
				}

				DetailMetadataStack {
					DetailMetadataRow(label: "ID", value: flow.id, monospaced: true)
					DetailMetadataRow(label: "Persona", value: flow.personaLabel)
					DetailMetadataRow(label: "Steps", value: "\(flow.nodes.count)")
					DetailMetadataRow(label: "Type", value: flow.builtin ? "Built-in" : "Custom")
					if let updatedAt = flow.updatedAt, let date = FlowISO8601.date(from: updatedAt) {
						DetailMetadataRow(
							label: "Updated",
							value: DateFormatter.localizedString(
								from: date,
								dateStyle: .medium,
								timeStyle: .short
							)
						)
					}
				}

				DetailSection(title: "About flows") {
					VStack(alignment: .leading, spacing: 8) {
						Text("Flows run a fixed sequence of Tool Executor and LLM Prompter nodes. They power dashboard AI blurbs and other non-chat workflows.")
							.font(.system(size: 13))
							.foregroundStyle(SettingsDesign.rowDescription)
							.fixedSize(horizontal: false, vertical: true)

						if flow.builtin {
							Text("Built-in flows remain read-only. Duplicate their idea as a new custom flow if you want to change the steps.")
								.font(.system(size: 13))
								.foregroundStyle(SettingsDesign.rowDescription)
								.fixedSize(horizontal: false, vertical: true)
						}
					}
				}

				if let destinations = flow.destinations, !destinations.isEmpty {
					DetailSection(title: "When it finishes") {
						VStack(alignment: .leading, spacing: 6) {
							ForEach(Array(destinations.enumerated()), id: \.offset) { _, dest in
								Text(dest.summary)
									.font(.system(size: 13))
									.foregroundStyle(SettingsDesign.rowDescription)
							}
						}
					}
				}

				if let errorMessage = store.errorMessage, !store.flows.isEmpty {
					InlineStatusMessage(message: errorMessage, tone: .error, font: .caption)
				}
			}
			.frame(maxWidth: SettingsDesign.contentMaxWidth + 80)
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.padding(20)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.accessibilityIdentifier("flow-details-tab")
	}
}

struct FlowRecentRunsPane: View {
	@Bindable var store: FlowsStore

	var body: some View {
		Group {
			if store.isRunsLoading && store.runs.isEmpty {
				VStack(spacing: 12) {
					ProgressView()
						.controlSize(.small)
					Text("Loading runs…")
						.font(.system(size: 13))
						.foregroundStyle(SettingsDesign.rowDescription)
				}
				.frame(maxWidth: .infinity, maxHeight: .infinity)
			} else if store.runs.isEmpty {
				ContentUnavailableView {
					Label {
						Text("No runs yet")
					} icon: {
						Image(systemName: "clock.arrow.circlepath")
							.accessibilityHidden(true)
					}
				} description: {
					Text("Dashboard cards and other callers will show history here after they execute this flow.")
				}
				.frame(maxWidth: .infinity, maxHeight: .infinity)
			} else {
				ScrollView {
					VStack(alignment: .leading, spacing: 0) {
						ForEach(Array(store.runs.enumerated()), id: \.element.id) { index, run in
							Button {
								Task { await store.selectRun(id: run.id) }
							} label: {
								FlowRunRow(run: run)
							}
							.buttonStyle(.plain)
							if index < store.runs.count - 1 {
								Rectangle()
									.fill(SettingsDesign.cardBorder)
									.frame(height: 1)
							}
						}
					}
					.frame(maxWidth: .infinity, alignment: .leading)
				}
			}
		}
		.padding(20)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.accessibilityIdentifier("flow-recent-runs-tab")
	}
}

private struct FlowNodePipeline: View {
	let nodes: [FlowNodeSnapshot]

	var body: some View {
		Group {
			if nodes.isEmpty {
				Text("This flow has no steps.")
					.font(.system(size: 13))
					.foregroundStyle(SettingsDesign.rowDescription)
			} else {
				VStack(alignment: .leading, spacing: 0) {
					ForEach(Array(nodes.enumerated()), id: \.element.id) { index, node in
						FlowPipelineStep(
							index: index + 1,
							total: nodes.count,
							node: node
						)
						if index < nodes.count - 1 {
							Image(systemName: "chevron.down")
								.font(.system(size: 10, weight: .semibold))
								.foregroundStyle(AppTheme.tertiaryText)
								.frame(maxWidth: .infinity)
								.padding(.vertical, 6)
								.accessibilityHidden(true)
								.accessibilityIdentifier("flow-pipeline-connector")
						}
					}
				}
			}
		}
		.frame(maxWidth: .infinity, alignment: .leading)
		.accessibilityIdentifier("flow-node-pipeline")
	}
}

private struct FlowPipelineStep: View {
	let index: Int
	let total: Int
	let node: FlowNodeSnapshot

	var body: some View {
		let shape = AppTheme.concentricRect(minimum: SettingsDesign.cardCornerRadius)
		HStack(alignment: .top, spacing: 12) {
			ZStack {
				Circle()
					.fill(AppTheme.accent.opacity(0.16))
					.frame(width: 22, height: 22)
				Text("\(index)")
					.font(.system(size: 11, weight: .semibold))
					.foregroundStyle(AppTheme.accent)
			}

			VStack(alignment: .leading, spacing: 4) {
				HStack(spacing: 8) {
					Image(systemName: node.systemImage)
						.font(.system(size: 12, weight: .semibold))
						.foregroundStyle(AppTheme.secondaryText)
						.accessibilityHidden(true)
					Text(node.typeLabel)
						.font(.system(size: 13, weight: .semibold))
						.foregroundStyle(SettingsDesign.rowTitle)
				}
				Text(node.detailLabel)
					.font(.system(size: 12, design: .monospaced))
					.foregroundStyle(SettingsDesign.rowDescription)
					.lineLimit(2)
					.textSelection(.enabled)
				Text(node.id)
					.font(.system(size: 11, design: .monospaced))
					.foregroundStyle(AppTheme.tertiaryText)
					.lineLimit(1)
					.textSelection(.enabled)
			}
			Spacer(minLength: 0)
		}
		.padding(12)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(SettingsDesign.cardBackground, in: shape)
		.overlay {
			shape.stroke(SettingsDesign.cardBorder, lineWidth: 1)
		}
		.accessibilityElement(children: .combine)
		.accessibilityLabel("Step \(index) of \(total), \(node.typeLabel), \(node.detailLabel)")
	}
}

private struct FlowRunRow: View {
	let run: FlowRunSummary

	var body: some View {
		HStack(spacing: 10) {
			Image(systemName: run.statusIcon)
				.font(.system(size: 14))
				.foregroundStyle(run.statusColor)
				.frame(width: 18)

			VStack(alignment: .leading, spacing: 2) {
				HStack(spacing: 8) {
					Text(run.displayStatus)
						.font(.system(size: 13, weight: .semibold))
						.foregroundStyle(SettingsDesign.rowTitle)
					if let trigger = run.trigger, !trigger.isEmpty {
						Text(trigger)
							.font(.system(size: 11))
							.foregroundStyle(AppTheme.tertiaryText)
							.lineLimit(1)
					}
				}
				Text(run.startedLabel)
					.font(.system(size: 11))
					.foregroundStyle(SettingsDesign.rowDescription)
			}

			Spacer(minLength: 0)

			VStack(alignment: .trailing, spacing: 2) {
				Text(run.durationLabel)
					.font(.system(size: 11, weight: .medium))
					.foregroundStyle(AppTheme.secondaryText)
				if let model = run.model, !model.isEmpty {
					Text(model)
						.font(.system(size: 10))
						.foregroundStyle(AppTheme.tertiaryText)
						.lineLimit(1)
				}
			}

			Image(systemName: "chevron.right")
				.font(.system(size: 10, weight: .semibold))
				.foregroundStyle(AppTheme.tertiaryText)
		}
		.padding(.vertical, 10)
		.padding(.horizontal, 4)
		.contentShape(Rectangle())
	}
}
