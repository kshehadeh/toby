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
	@State private var showsTechnicalDetails: Bool

	init(store: FlowsStore, flow: FlowListItem, showsTechnicalDetails: Bool = false) {
		_store = Bindable(store)
		self.flow = flow
		_showsTechnicalDetails = State(initialValue: showsTechnicalDetails)
	}

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 26) {
				FlowOverviewHeader(flow: flow)

				DetailSection(title: "How it works") {
					FlowStoryCard(flow: flow)
				}

				DisclosureGroup(isExpanded: $showsTechnicalDetails) {
					FlowTechnicalDetails(flow: flow)
						.padding(.top, 10)
				} label: {
					HStack(spacing: 6) {
						Text("Technical details")
							.font(.system(size: 13, weight: .semibold))
							.foregroundStyle(SettingsDesign.rowTitle)
						Text("For troubleshooting")
							.font(.system(size: 12))
							.foregroundStyle(AppTheme.tertiaryText)
					}
				}
				.accessibilityIdentifier("flow-technical-details")

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

/// Flow glyph tile, name, plain summary, and a quiet type/updated line.
private struct FlowOverviewHeader: View {
	let flow: FlowListItem

	var body: some View {
		HStack(alignment: .top, spacing: 14) {
			Image(systemName: flow.systemImage)
				.font(.system(size: 19, weight: .semibold))
				.foregroundStyle(.white)
				.frame(width: 44, height: 44)
				.background(
					FlowColorOption.resolved(flow.color).color,
					in: RoundedRectangle(cornerRadius: 12, style: .continuous)
				)
				.accessibilityHidden(true)

			VStack(alignment: .leading, spacing: 6) {
				Text(flow.displayName)
					.font(.system(size: 17, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)
					.textSelection(.enabled)

				Text(flow.overviewSummary)
					.font(.system(size: 13))
					.foregroundStyle(SettingsDesign.rowDescription)
					.fixedSize(horizontal: false, vertical: true)
					.textSelection(.enabled)

				HStack(spacing: 8) {
					Text(flow.builtin ? "Built-in" : "Custom")
						.font(.system(size: 9, weight: .semibold))
						.foregroundStyle(AppTheme.tertiaryText)
						.padding(.horizontal, 5)
						.padding(.vertical, 1)
						.background(Capsule().fill(AppTheme.primaryText.opacity(0.08)))
					if let updated = flow.updatedLabel {
						Text("Updated \(updated)")
							.font(.system(size: 12))
							.foregroundStyle(AppTheme.tertiaryText)
					}
				}
				.padding(.top, 2)

				if flow.builtin {
					Text("Built-in flows are read-only. Create a custom flow if you want to change the steps.")
						.font(.system(size: 12))
						.foregroundStyle(SettingsDesign.rowDescription)
						.fixedSize(horizontal: false, vertical: true)
						.padding(.top, 2)
				}
			}
			Spacer(minLength: 0)
		}
		.frame(maxWidth: .infinity, alignment: .leading)
		.accessibilityIdentifier("flow-overview-header")
	}
}

/// "How it works": every step and destination as a sentence on one card,
/// grouped into Gathers / Thinks / Shares and joined by a hairline rail.
private struct FlowStoryCard: View {
	let flow: FlowListItem

	var body: some View {
		let rows = FlowStory.rows(for: flow)
		let shape = AppTheme.concentricRect(minimum: SettingsDesign.cardCornerRadius)
		Group {
			if flow.nodes.isEmpty {
				Text("This flow has no steps.")
					.font(.system(size: 13))
					.foregroundStyle(SettingsDesign.rowDescription)
			} else {
				VStack(alignment: .leading, spacing: 0) {
					ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
						if row.startsPhase {
							FlowStoryPhaseLabel(phase: row.phase, showsRail: index > 0)
						}
						FlowStoryRowView(row: row, isLast: index == rows.count - 1)
					}
				}
				.padding(.horizontal, 18)
				.padding(.vertical, 16)
				.frame(maxWidth: .infinity, alignment: .leading)
				.background(SettingsDesign.cardBackground, in: shape)
				.overlay {
					shape.stroke(SettingsDesign.cardBorder, lineWidth: 1)
				}
			}
		}
		.frame(maxWidth: .infinity, alignment: .leading)
		.accessibilityIdentifier("flow-node-pipeline")
	}
}

private enum FlowStoryMetrics {
	static let iconSize: CGFloat = 30
	static let columnSpacing: CGFloat = 14
}

private struct FlowStoryPhaseLabel: View {
	let phase: FlowStoryPhase
	let showsRail: Bool

	var body: some View {
		HStack(spacing: FlowStoryMetrics.columnSpacing) {
			ZStack {
				if showsRail {
					Rectangle()
						.fill(SettingsDesign.cardBorder)
						.frame(width: 1)
				}
			}
			.frame(width: FlowStoryMetrics.iconSize)
			.frame(maxHeight: .infinity)

			Text(phase.label.uppercased())
				.font(.system(size: 10, weight: .semibold))
				.tracking(0.7)
				.foregroundStyle(AppTheme.tertiaryText)
				.padding(.top, showsRail ? 8 : 0)
				.padding(.bottom, 8)
		}
		.fixedSize(horizontal: false, vertical: true)
		.accessibilityAddTraits(.isHeader)
	}
}

private struct FlowStoryRowView: View {
	let row: FlowStoryRow
	let isLast: Bool

	var body: some View {
		HStack(alignment: .top, spacing: FlowStoryMetrics.columnSpacing) {
			VStack(spacing: 0) {
				FlowStoryIcon(row: row)
				if !isLast {
					Rectangle()
						.fill(SettingsDesign.cardBorder)
						.frame(width: 1)
						.frame(minHeight: 10, maxHeight: .infinity)
						.accessibilityHidden(true)
						.accessibilityIdentifier("flow-pipeline-connector")
				}
			}
			.frame(width: FlowStoryMetrics.iconSize)

			VStack(alignment: .leading, spacing: 2) {
				Text(row.title)
					.font(.system(size: 13, weight: .medium))
					.foregroundStyle(SettingsDesign.rowTitle)
					.fixedSize(horizontal: false, vertical: true)
				if let subtitle = row.subtitle {
					Text(subtitle)
						.font(.system(size: 12))
						.foregroundStyle(SettingsDesign.rowDescription)
						.fixedSize(horizontal: false, vertical: true)
				}
			}
			.padding(.top, 6)
			.padding(.bottom, isLast ? 0 : 14)

			Spacer(minLength: 0)
		}
		.fixedSize(horizontal: false, vertical: true)
		.accessibilityElement(children: .combine)
		.accessibilityLabel([row.title, row.subtitle].compactMap { $0 }.joined(separator: ", "))
	}
}

private struct FlowStoryIcon: View {
	let row: FlowStoryRow

	var body: some View {
		let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
		ZStack {
			shape.fill(fill)
			if let url = row.iconURL {
				AsyncImage(url: url) { phase in
					switch phase {
					case .success(let image):
						image
							.resizable()
							.scaledToFit()
							.frame(width: 18, height: 18)
					default:
						symbol
					}
				}
			} else {
				symbol
			}
		}
		.frame(width: FlowStoryMetrics.iconSize, height: FlowStoryMetrics.iconSize)
		.overlay {
			if row.tint == .neutral {
				shape.stroke(SettingsDesign.cardBorder, lineWidth: 1)
			}
		}
		.accessibilityHidden(true)
	}

	private var fill: Color {
		switch row.tint {
		case .accent: return AppTheme.accent.opacity(0.18)
		case .neutral: return row.iconURL == nil ? AppTheme.primaryText.opacity(0.05) : .white
		}
	}

	private var symbol: some View {
		Image(systemName: row.systemImage)
			.font(.system(size: 13, weight: .semibold))
			.foregroundStyle(row.tint == .accent ? AppTheme.accent : AppTheme.secondaryText)
	}
}

/// IDs, node types and tool names for troubleshooting, collapsed by default.
private struct FlowTechnicalDetails: View {
	let flow: FlowListItem

	var body: some View {
		let shape = AppTheme.concentricRect(minimum: SettingsDesign.cardCornerRadius)
		VStack(alignment: .leading, spacing: 14) {
			DetailMetadataStack {
				DetailMetadataRow(label: "Flow ID", value: flow.id, monospaced: true)
				DetailMetadataRow(label: "Persona", value: flow.personaLabel)
				DetailMetadataRow(label: "Type", value: flow.builtin ? "Built-in" : "Custom")
				if let updated = flow.updatedLabel {
					DetailMetadataRow(label: "Updated", value: updated)
				}
				if let destinations = flow.destinations, !destinations.isEmpty {
					DetailMetadataRow(
						label: "Delivers to",
						value: destinations.map(\.summary).joined(separator: ", ")
					)
				}
			}

			if !flow.nodes.isEmpty {
				Rectangle()
					.fill(SettingsDesign.cardBorder)
					.frame(height: 1)

				Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 16, verticalSpacing: 6) {
					GridRow {
						Text("Step")
						Text("ID")
						Text("Runs")
					}
					.font(.system(size: 12))
					.foregroundStyle(AppTheme.tertiaryText)

					ForEach(Array(flow.nodes.enumerated()), id: \.element.id) { index, node in
						GridRow {
							Text("\(index + 1)")
								.font(.system(size: 12))
								.foregroundStyle(SettingsDesign.rowDescription)
							Text(node.id)
								.font(.system(size: 12, design: .monospaced))
								.foregroundStyle(SettingsDesign.rowTitle)
								.textSelection(.enabled)
							VStack(alignment: .leading, spacing: 2) {
								Text(node.typeLabel)
									.font(.system(size: 12))
									.foregroundStyle(SettingsDesign.rowDescription)
								Text(node.detailLabel)
									.font(.system(size: 12, design: .monospaced))
									.foregroundStyle(SettingsDesign.rowTitle)
									.lineLimit(2)
									.textSelection(.enabled)
							}
						}
					}
				}
				.frame(maxWidth: .infinity, alignment: .leading)
			}
		}
		.padding(.horizontal, 18)
		.padding(.vertical, 14)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(SettingsDesign.cardBackground, in: shape)
		.overlay {
			shape.stroke(SettingsDesign.cardBorder, lineWidth: 1)
		}
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
