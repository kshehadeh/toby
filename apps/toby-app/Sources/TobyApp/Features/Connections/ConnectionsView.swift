import SwiftUI

/// Connections workspace: an interactive map of Toby's context graph — the
/// people, organizations, projects, topics, and memories it has learned
/// about, and how they relate.
struct ConnectionsView: View {
	@Bindable var store: ConnectionsStore

	var body: some View {
		HStack(spacing: 0) {
			graphArea
			if let node = store.selectedNode {
				Divider()
				ConnectionsInspector(
					node: node,
					connections: store.connections(of: node.id),
					onSelect: { id in
						store.selectedNodeId = id
						store.pendingCenterId = id
					},
					onClose: { store.selectedNodeId = nil }
				)
				.frame(width: 300)
				.transition(.move(edge: .trailing))
			}
		}
		.animation(.snappy(duration: 0.2), value: store.selectedNodeId == nil)
		.background(AppTheme.contentBackground)
		.task { await store.ensureLoaded() }
		.accessibilityIdentifier("connections-workspace")
		.tutorialTip(.connections)
	}

	@ViewBuilder
	private var graphArea: some View {
		ZStack {
			if !store.hasLoadedOnce {
				ProgressView("Loading connections…")
			} else if let error = store.errorMessage, store.snapshot.nodes.isEmpty {
				ContentUnavailableView {
					Label("Couldn't load connections", systemImage: "exclamationmark.triangle")
				} description: {
					Text(error)
				} actions: {
					Button("Try Again") { Task { await store.load() } }
				}
			} else if store.snapshot.nodes.isEmpty {
				emptyState
			} else {
				ConnectionsGraphCanvas(store: store)
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.overlay(alignment: .top) { controlBar }
		.overlay(alignment: .bottomLeading) {
			if store.hasLoadedOnce { ConnectionsLegend(store: store) }
		}
	}

	private var emptyState: some View {
		ContentUnavailableView {
			Label("No connections yet", systemImage: "point.3.connected.trianglepath.dotted")
		} description: {
			Text(store.visibleKinds == GraphNodeKind.defaultVisible
				? "Toby builds this map as it learns about the people, projects, and topics in your mail, calendar, chats, and memories."
				: "Nothing matches the selected kinds. Turn more kinds on in the legend.")
		}
		.accessibilityIdentifier("connections-empty-state")
	}

	private var controlBar: some View {
		HStack(spacing: 10) {
			HStack(spacing: 6) {
				Image(systemName: "magnifyingglass")
					.foregroundStyle(AppTheme.tertiaryText)
					.accessibilityHidden(true)
				TextField("Find a person, project, or topic", text: $store.searchQuery)
					.textFieldStyle(.plain)
					.frame(width: 220)
					.onSubmit(focusFirstMatch)
					.accessibilityIdentifier("connections-search-field")
			}
			.padding(.horizontal, 12)
			.padding(.vertical, 7)
			.glassEffect(.regular.interactive(), in: Capsule())

			Spacer(minLength: 8)

			if store.isLoading && store.hasLoadedOnce {
				ProgressView().controlSize(.small)
			}
			if !store.summaryLine.isEmpty {
				Text(store.summaryLine)
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
					.accessibilityIdentifier("connections-summary")
			}
			Menu {
				Picker("Nodes shown", selection: Binding(
					get: { store.nodeLimit },
					set: { store.setNodeLimit($0) }
				)) {
					ForEach(ConnectionsStore.nodeLimitOptions, id: \.self) { Text("Up to \($0)").tag($0) }
				}
				.pickerStyle(.inline)
			} label: {
				Label("Nodes shown", systemImage: "slider.horizontal.3")
			}
			.menuStyle(.button)
			.buttonStyle(.borderless)
			.labelStyle(.iconOnly)
			.fixedSize()
			.help("Choose how many nodes to show")
			.accessibilityIdentifier("connections-limit-menu")
		}
		.padding(14)
	}

	/// Select and center the strongest match; the canvas centers via the store.
	private func focusFirstMatch() {
		let matches = store.searchMatches
		guard let first = store.snapshot.nodes.first(where: { matches.contains($0.id) }) else { return }
		store.selectedNodeId = first.id
		store.searchQuery = ""
		store.pendingCenterId = first.id
	}
}

/// Color key that doubles as the kind filter.
struct ConnectionsLegend: View {
	@Bindable var store: ConnectionsStore

	var body: some View {
		let counts = store.kindCounts
		VStack(alignment: .leading, spacing: 2) {
			ForEach(GraphNodeKind.allCases) { kind in
				let isOn = store.visibleKinds.contains(kind)
				Button {
					store.toggleKind(kind)
				} label: {
					HStack(spacing: 8) {
						Circle()
							.fill(kind.color.opacity(isOn ? 1 : 0.25))
							.frame(width: 9, height: 9)
						Text(kind.title)
							.foregroundStyle(isOn ? AppTheme.primaryText : AppTheme.tertiaryText)
						Spacer(minLength: 8)
						if isOn, let count = counts[kind] {
							Text("\(count)")
								.foregroundStyle(AppTheme.tertiaryText)
								.monospacedDigit()
						}
					}
					.font(.caption)
					.frame(width: 150)
					.contentShape(Rectangle())
				}
				.buttonStyle(.plain)
				.help(isOn ? "Hide \(kind.title.lowercased())" : "Show \(kind.title.lowercased())")
				.accessibilityLabel(kind.title)
				.accessibilityValue(isOn ? "Shown" : "Hidden")
				.accessibilityIdentifier("connections-legend-\(kind.rawValue)")
			}
		}
		.padding(12)
		.glassEffect(.regular, in: AppTheme.concentricRect(minimum: AppTheme.smallCornerRadius))
		.padding(14)
	}
}
