import SwiftUI

struct FlowDetailContent: View {
	@Bindable var store: FlowsStore
	let flow: FlowListItem

	var body: some View {
		VStack(spacing: 0) {
			header
				.padding(.horizontal, 24)
				.padding(.vertical, 18)

			Divider().overlay(SettingsDesign.cardBorder)

			HStack(spacing: 0) {
				mainColumn
				Divider().overlay(SettingsDesign.cardBorder)
				inspectorColumn
			}
			.frame(maxWidth: .infinity, maxHeight: .infinity)
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(SettingsDesign.canvasBackground)
	}

	private var header: some View {
		HStack(alignment: .center, spacing: 14) {
			RoundedRectangle(cornerRadius: 12)
				.fill(AppTheme.accent.opacity(0.16))
				.frame(width: 48, height: 48)
				.overlay {
					Image(systemName: flow.systemImage)
						.font(.system(size: 20, weight: .semibold))
						.foregroundStyle(AppTheme.accent)
				}

			VStack(alignment: .leading, spacing: 4) {
				HStack(spacing: 8) {
					Text(flow.displayName)
						.font(.system(size: 20, weight: .semibold))
						.foregroundStyle(SettingsDesign.rowTitle)
					if flow.builtin {
						Text("Built-in")
							.font(.system(size: 11, weight: .semibold))
							.foregroundStyle(AppTheme.secondaryText)
							.padding(.horizontal, 8)
							.padding(.vertical, 3)
							.background(
								Capsule()
									.fill(Color.white.opacity(0.08))
							)
					}
				}
				Text(flow.id)
					.font(.system(size: 12, design: .monospaced))
					.foregroundStyle(AppTheme.tertiaryText)
					.lineLimit(1)
					.textSelection(.enabled)
			}

			Spacer(minLength: 0)

			if flow.builtin {
				Text("Built-in flows can’t be edited or deleted")
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
					.multilineTextAlignment(.trailing)
					.frame(maxWidth: 180)
			}
		}
	}

	private var mainColumn: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 22) {
				if let description = flow.description, !description.isEmpty {
					section(title: "Description") {
						Text(description)
							.font(.body)
							.foregroundStyle(SettingsDesign.rowTitle)
							.frame(maxWidth: .infinity, alignment: .leading)
							.fixedSize(horizontal: false, vertical: true)
					}
				}

				section(title: "Nodes") {
					VStack(alignment: .leading, spacing: 0) {
						ForEach(Array(flow.nodes.enumerated()), id: \.element.id) { index, node in
							FlowNodeRow(index: index + 1, node: node)
							if index < flow.nodes.count - 1 {
								// Connector between steps
								HStack(spacing: 0) {
									Rectangle()
										.fill(SettingsDesign.cardBorder)
										.frame(width: 2, height: 14)
										.padding(.leading, 23)
									Spacer()
								}
							}
						}
					}
				}

				section(title: "Recent runs") {
					if store.isRunsLoading && store.runs.isEmpty {
						HStack {
							ProgressView()
								.controlSize(.small)
							Text("Loading runs…")
								.font(.caption)
								.foregroundStyle(SettingsDesign.rowDescription)
						}
						.padding(.vertical, 8)
					} else if store.runs.isEmpty {
						Text("No runs yet. Dashboard cards and other callers will show history here after they execute this flow.")
							.font(.system(size: 13))
							.foregroundStyle(SettingsDesign.rowDescription)
							.fixedSize(horizontal: false, vertical: true)
					} else {
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
					}
				}

				if let errorMessage = store.errorMessage, !store.flows.isEmpty {
					InlineStatusMessage(message: errorMessage, tone: .error, font: .caption)
				}
			}
			.padding(24)
			.frame(maxWidth: SettingsDesign.contentMaxWidth + 80)
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
	}

	private var inspectorColumn: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 18) {
				Text("Details")
					.font(.system(size: 13, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)

				metadataRow(label: "ID", value: flow.id, monospaced: true)
				metadataRow(label: "Persona", value: flow.personaLabel)
				metadataRow(label: "Nodes", value: "\(flow.nodes.count)")
				metadataRow(label: "Type", value: flow.builtin ? "Built-in" : "Custom")
				if let updatedAt = flow.updatedAt, let date = FlowISO8601.date(from: updatedAt) {
					metadataRow(
						label: "Updated",
						value: DateFormatter.localizedString(from: date, dateStyle: .medium, timeStyle: .short)
					)
				}

				Divider().overlay(SettingsDesign.cardBorder)

				Text("About flows")
					.font(.system(size: 12, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)
				Text("Flows run a fixed sequence of Tool Executor and LLM Prompter nodes. They power dashboard AI blurbs and other non-chat workflows.")
					.font(.system(size: 11))
					.foregroundStyle(SettingsDesign.rowDescription)
					.fixedSize(horizontal: false, vertical: true)

				if flow.builtin {
					Text("Custom flow editing and deletion will be available in a future update. Built-in flows remain read-only.")
						.font(.system(size: 11))
						.foregroundStyle(SettingsDesign.rowDescription)
						.fixedSize(horizontal: false, vertical: true)
				}
			}
			.padding(18)
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.frame(width: 260)
		.background(AppTheme.sidebarBackground)
	}

	private func section<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
		VStack(alignment: .leading, spacing: 10) {
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

	private func metadataRow(label: String, value: String, monospaced: Bool = false) -> some View {
		VStack(alignment: .leading, spacing: 3) {
			Text(label)
				.font(.system(size: 11))
				.foregroundStyle(SettingsDesign.rowDescription)
			Text(value)
				.font(monospaced ? .system(size: 12, design: .monospaced) : .system(size: 12))
				.foregroundStyle(SettingsDesign.rowTitle)
				.lineLimit(3)
				.textSelection(.enabled)
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}
}

private struct FlowNodeRow: View {
	let index: Int
	let node: FlowNodeSnapshot

	var body: some View {
		HStack(alignment: .top, spacing: 12) {
			ZStack {
				Circle()
					.fill(AppTheme.accent.opacity(0.16))
					.frame(width: 28, height: 28)
				Text("\(index)")
					.font(.system(size: 12, weight: .semibold))
					.foregroundStyle(AppTheme.accent)
			}

			VStack(alignment: .leading, spacing: 4) {
				HStack(spacing: 8) {
					Image(systemName: node.systemImage)
						.font(.system(size: 12, weight: .semibold))
						.foregroundStyle(AppTheme.secondaryText)
					Text(node.id)
						.font(.system(size: 13, weight: .semibold))
						.foregroundStyle(SettingsDesign.rowTitle)
				}
				Text(node.typeLabel)
					.font(.system(size: 11, weight: .medium))
					.foregroundStyle(AppTheme.secondaryText)
				Text(node.detailLabel)
					.font(.system(size: 12, design: .monospaced))
					.foregroundStyle(SettingsDesign.rowDescription)
					.lineLimit(2)
					.textSelection(.enabled)
			}
			Spacer(minLength: 0)
		}
		.padding(.vertical, 8)
		.padding(.horizontal, 4)
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
