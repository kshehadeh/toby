import SwiftUI

struct LibraryInspectorBar: View {
	@Bindable var store: LibraryStore
	var onQuickLook: () -> Void
	var onReveal: () -> Void
	@State private var isExpanded = true

	var body: some View {
		VStack(spacing: 0) {
			Rectangle()
				.fill(SettingsDesign.cardBorder)
				.frame(height: 1)
			content
		}
		.frame(maxWidth: .infinity)
		.background(SettingsDesign.canvasBackground)
		.accessibilityIdentifier("library-inspector-bar")
	}

	@ViewBuilder
	private var content: some View {
		if store.selectedItemIds.count > 1 {
			multiSelectionContent
		} else if let item = store.inspectedItem {
			singleSelectionContent(item)
		} else {
			emptySelectionContent
		}
	}

	private func singleSelectionContent(_ item: LibraryAsset) -> some View {
		VStack(alignment: .leading, spacing: 0) {
			headerRow(item)
			if isExpanded {
				itemDetails(item)
			}
		}
	}

	private func headerRow(_ item: LibraryAsset) -> some View {
		HStack(spacing: 8) {
			Button {
				withAnimation(nil) {
					isExpanded.toggle()
				}
			} label: {
				HStack(spacing: 6) {
					Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
						.font(.system(size: 10, weight: .semibold))
						.foregroundStyle(AppTheme.tertiaryText)
						.frame(width: 12)
					Text("Details")
						.font(.system(size: 12, weight: .semibold))
						.foregroundStyle(SettingsDesign.rowTitle)
				}
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.accessibilityIdentifier("library-inspector-toggle")
			.accessibilityLabel(isExpanded ? "Hide details" : "Show details")
			Spacer(minLength: 0)
			Button("Quick Look", systemImage: "eye", action: onQuickLook)
				.controlSize(.small)
				.accessibilityIdentifier("library-quick-look-button")
			Button("Reveal", systemImage: "folder", action: onReveal)
				.controlSize(.small)
				.accessibilityIdentifier("library-reveal-button")
			Button("Delete", systemImage: "trash", role: .destructive) {
				store.requestDelete(item)
			}
			.controlSize(.small)
			.disabled(store.isSaving)
			.accessibilityIdentifier("delete-library-item-button")
		}
		.padding(.horizontal, 16)
		.padding(.vertical, 10)
	}

	private func itemDetails(_ item: LibraryAsset) -> some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 12) {
				Text(item.title)
					.font(.body)
					.fontWeight(.semibold)
					.foregroundStyle(SettingsDesign.rowTitle)
					.frame(maxWidth: .infinity, alignment: .leading)
					.textSelection(.enabled)
					.accessibilityIdentifier("library-inspector-title")
				if !item.description.isEmpty {
					Text(item.description)
						.font(.body)
						.foregroundStyle(SettingsDesign.rowTitle)
						.frame(maxWidth: .infinity, alignment: .leading)
						.fixedSize(horizontal: false, vertical: true)
						.textSelection(.enabled)
						.accessibilityIdentifier("library-inspector-description")
				}
				if let error = item.error, !error.isEmpty {
					Text(error)
						.font(.callout)
								.foregroundStyle(AppTheme.statusErrorForeground)
						.textSelection(.enabled)
				}
				DetailMetadataStack {
					DetailMetadataRow(label: "File", value: item.originalFilename)
					DetailMetadataRow(label: "Type", value: item.mimeType)
					DetailMetadataRow(label: "Size", value: item.byteSizeLabel)
					DetailMetadataRow(label: "Status", value: item.status)
					DetailMetadataRow(label: "Embedding", value: item.embeddingModel ?? "None")
					DetailMetadataRow(label: "Created", value: MemoryDateFormat.display(item.createdAt))
					DetailMetadataRow(label: "Updated", value: MemoryDateFormat.display(item.updatedAt))
				}
			}
			.padding(.horizontal, 16)
			.padding(.bottom, 14)
		}
		.frame(maxHeight: 220)
	}

	private var emptySelectionContent: some View {
		VStack(spacing: 8) {
			Image(systemName: "books.vertical")
				.font(.system(size: 28, weight: .regular))
				.foregroundStyle(AppTheme.tertiaryText)
				.accessibilityHidden(true)
			Text("No library item selected")
				.font(.headline)
				.foregroundStyle(SettingsDesign.rowTitle)
			Text("Select a file to view its details")
				.font(.subheadline)
				.foregroundStyle(SettingsDesign.rowDescription)
		}
		.frame(maxWidth: .infinity)
		.padding(.horizontal, 16)
		.padding(.vertical, 28)
		.accessibilityElement(children: .combine)
		.accessibilityIdentifier("library-inspector-empty")
	}

	private var multiSelectionContent: some View {
		HStack(spacing: 8) {
			Text("\(store.selectedItemIds.count) items selected")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			Spacer(minLength: 0)
			Button("Delete", systemImage: "trash", role: .destructive) {
				store.requestDeleteSelected()
			}
			.controlSize(.small)
			.disabled(store.isSaving)
			.accessibilityIdentifier("delete-library-items-button")
		}
		.padding(.horizontal, 16)
		.padding(.vertical, 10)
		.padding(.bottom, 10)
	}
}
