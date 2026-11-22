import SwiftUI

/// Side panel for the selected node: what it is and what it links to.
struct ConnectionsInspector: View {
	let node: GraphSnapshotNode
	let connections: [GraphConnection]
	let onSelect: (String) -> Void
	let onClose: () -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			header
				.padding(16)
			Divider()
			if connections.isEmpty {
				Text("No links to other nodes shown here.")
					.font(.callout)
					.foregroundStyle(AppTheme.secondaryText)
					.padding(16)
				Spacer(minLength: 0)
			} else {
				List {
					Section("Connections (\(connections.count))") {
						ForEach(connections) { connection in
							ConnectionsInspectorRow(selectedId: node.id, connection: connection)
								.contentShape(Rectangle())
								.onTapGesture { onSelect(connection.node.id) }
								.accessibilityAddTraits(.isButton)
								.accessibilityAction { onSelect(connection.node.id) }
						}
					}
				}
				.listStyle(.sidebar)
				.scrollContentBackground(.hidden)
				.accessibilityIdentifier("connections-inspector-list")
			}
		}
		.frame(maxHeight: .infinity, alignment: .top)
		.background(AppTheme.panelBackground)
		.accessibilityIdentifier("connections-inspector")
	}

	private var header: some View {
		VStack(alignment: .leading, spacing: 10) {
			HStack(alignment: .firstTextBaseline) {
				Label(node.kind?.singularTitle ?? node.type.capitalized, systemImage: node.kind?.systemImage ?? "circle")
					.font(.caption.weight(.semibold))
					.foregroundStyle(node.kind?.color ?? AppTheme.secondaryText)
				Spacer()
				Button("Close", systemImage: "xmark", action: onClose)
					.labelStyle(.iconOnly)
					.buttonStyle(.borderless)
					.foregroundStyle(AppTheme.secondaryText)
					.accessibilityIdentifier("connections-inspector-close")
			}
			Text(node.label)
				.font(.title3.weight(.semibold))
				.foregroundStyle(AppTheme.primaryText)
				.textSelection(.enabled)
				.fixedSize(horizontal: false, vertical: true)
			if let detail = node.detail, detail != node.label {
				Text(detail)
					.font(.callout)
					.foregroundStyle(AppTheme.secondaryText)
					.textSelection(.enabled)
					.lineLimit(6)
					.fixedSize(horizontal: false, vertical: true)
			}
			HStack(spacing: 12) {
				Label("\(node.degree) total links", systemImage: "point.3.connected.trianglepath.dotted")
				if let updated = Self.relativeDate(node.updatedAt) {
					Label(updated, systemImage: "clock")
				}
			}
			.font(.caption)
			.foregroundStyle(AppTheme.tertiaryText)
		}
	}

	static func relativeDate(_ iso: String) -> String? {
		let formatter = ISO8601DateFormatter()
		formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		guard let date = formatter.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return nil }
		return "Updated \(date.formatted(.relative(presentation: .named)))"
	}
}

private struct ConnectionsInspectorRow: View {
	let selectedId: String
	let connection: GraphConnection

	var body: some View {
		HStack(spacing: 10) {
			Image(systemName: connection.node.kind?.systemImage ?? "circle")
				.foregroundStyle(connection.node.kind?.color ?? AppTheme.secondaryText)
				.frame(width: 18)
				.accessibilityHidden(true)
			VStack(alignment: .leading, spacing: 2) {
				Text(connection.node.label)
					.foregroundStyle(AppTheme.primaryText)
					.lineLimit(1)
				Text(relation)
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
					.lineLimit(1)
			}
		}
		.padding(.vertical, 2)
		.accessibilityElement(children: .combine)
	}

	/// Direction-aware wording, e.g. "sent → Q3 deck" or "← mentions".
	private var relation: String {
		let edge = connection.edge
		if edge.type == "shared_activity" || edge.type == "related_to" || edge.type == "alias_of" {
			return edge.relationTitle
		}
		return edge.src == selectedId ? "\(edge.relationTitle) →" : "← \(edge.relationTitle)"
	}
}
