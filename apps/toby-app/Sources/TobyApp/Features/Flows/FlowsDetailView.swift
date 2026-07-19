import SwiftUI

struct FlowsDetailView: View {
	@Bindable var store: FlowsStore

	var body: some View {
		Group {
			if store.isListLoading && store.flows.isEmpty {
				ProgressView("Loading flows…")
					.frame(maxWidth: .infinity, maxHeight: .infinity)
			} else if let errorMessage = store.errorMessage, store.flows.isEmpty {
				ContentUnavailableView {
					Label("Flows unavailable", systemImage: "exclamationmark.triangle")
				} description: {
					Text(errorMessage)
				}
			} else if store.flows.isEmpty {
				FlowsEmptyStateView()
			} else if let flow = store.selectedFlow {
				FlowDetailContent(store: store, flow: flow)
			} else {
				FlowsHomeView(store: store)
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(SettingsDesign.canvasBackground)
	}
}

private struct FlowsEmptyStateView: View {
	var body: some View {
		VStack(spacing: 18) {
			Image(systemName: "arrow.triangle.branch")
				.font(.system(size: 72, weight: .regular))
				.foregroundStyle(SettingsDesign.rowDescription)
				.accessibilityHidden(true)

			VStack(spacing: 8) {
				Text("Flows")
					.font(.system(size: 28, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)

				Text("Flows are named pipelines that run fixed sequences of tools and model steps. Built-in dashboard flows appear here once the daemon is ready.")
					.font(.body)
					.foregroundStyle(SettingsDesign.rowDescription)
					.multilineTextAlignment(.center)
					.lineLimit(4)
					.frame(maxWidth: 480)
			}
		}
		.padding(32)
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.accessibilityElement(children: .contain)
		.accessibilityIdentifier("flows-empty-state")
	}
}

struct FlowsHomeView: View {
	@Bindable var store: FlowsStore

	private let columns = [
		GridItem(.adaptive(minimum: 240, maximum: 360), spacing: 16),
	]

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 20) {
				header
				LazyVGrid(columns: columns, spacing: 16) {
					ForEach(store.flows) { flow in
						Button {
							Task { await store.selectFlow(id: flow.id) }
						} label: {
							FlowCard(flow: flow)
						}
						.buttonStyle(.plain)
						.accessibilityIdentifier("flow-card-\(flow.id)")
					}
				}
			}
			.padding(24)
			.frame(maxWidth: 980)
			.frame(maxWidth: .infinity)
		}
		.background(SettingsDesign.canvasBackground)
		.accessibilityIdentifier("flows-home-view")
	}

	private var header: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Flows")
				.font(.system(size: 24, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			Text("Named pipelines that power dashboard summaries and other non-chat workflows. Select a flow to inspect its nodes and recent runs.")
				.font(.body)
				.foregroundStyle(SettingsDesign.rowDescription)
				.fixedSize(horizontal: false, vertical: true)
		}
	}
}

struct FlowCard: View {
	let flow: FlowListItem

	var body: some View {
		VStack(alignment: .leading, spacing: 12) {
			HStack(alignment: .top, spacing: 12) {
				RoundedRectangle(cornerRadius: 10)
					.fill(AppTheme.accent.opacity(0.16))
					.frame(width: 40, height: 40)
					.overlay {
						Image(systemName: flow.systemImage)
							.font(.system(size: 17, weight: .semibold))
							.foregroundStyle(AppTheme.accent)
					}
				VStack(alignment: .leading, spacing: 4) {
					Text(flow.displayName)
						.font(.system(size: 15, weight: .semibold))
						.foregroundStyle(SettingsDesign.rowTitle)
						.lineLimit(2)
						.multilineTextAlignment(.leading)
					HStack(spacing: 6) {
						if flow.builtin {
							Label("Built-in", systemImage: "lock.fill")
								.font(.system(size: 11, weight: .medium))
								.foregroundStyle(AppTheme.tertiaryText)
						}
						Text("\(flow.nodes.count) nodes")
							.font(.system(size: 11, weight: .medium))
							.foregroundStyle(AppTheme.tertiaryText)
					}
				}
				Spacer(minLength: 0)
			}

			Text(flow.subtitle)
				.font(.system(size: 12))
				.foregroundStyle(SettingsDesign.rowDescription)
				.lineLimit(3)
				.multilineTextAlignment(.leading)
				.frame(maxWidth: .infinity, alignment: .leading)
				.frame(minHeight: 48, alignment: .topLeading)

			HStack {
				Label(flow.personaLabel, systemImage: "person.crop.circle")
					.font(.system(size: 11))
					.foregroundStyle(AppTheme.secondaryText)
				Spacer()
				Image(systemName: "chevron.right")
					.font(.system(size: 11, weight: .semibold))
					.foregroundStyle(AppTheme.tertiaryText)
			}
		}
		.padding(16)
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
