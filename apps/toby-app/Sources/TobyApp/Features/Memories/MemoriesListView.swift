import AppKit
import SwiftUI

struct MemoriesListView: View {
	@Bindable var store: MemoriesStore

	var body: some View {
		FeatureBrowserList(
			isLoading: store.isListLoading,
			isEmpty: store.memories.isEmpty,
			loadingText: "Loading memories…",
			emptyText: "No memories",
			onClearSelection: { store.clearSelection() }
		) {
			ForEach(Array(store.memories.enumerated()), id: \.element.id) { index, memory in
				VStack(spacing: 0) {
					memoryRow(memory)
					if index < store.memories.count - 1 {
						Divider()
							.overlay(AppTheme.separator)
							.opacity(0.5)
							.padding(.leading, FeatureBrowserMetrics.glyphSize + FeatureBrowserMetrics.rowContentSpacing)
					}
				}
			}
		}
	}

	private func memoryRow(_ memory: MemoryItem) -> some View {
		Button {
			handleRowClick(memory)
		} label: {
			MemoryListRow(
				memory: memory,
				isSelected: store.selectedMemoryIds.contains(memory.id)
			)
		}
		.buttonStyle(.plain)
		.contextMenu {
			Button("Edit Memory", systemImage: "square.and.pencil") {
				store.startEdit(memory)
			}
			Button("Delete Memory", systemImage: "trash", role: .destructive) {
				store.requestDelete(memory)
			}
			.disabled(store.isSaving)
		}
	}

	private func handleRowClick(_ memory: MemoryItem) {
		if NSEvent.modifierFlags.contains(.command) {
			var ids = store.selectedMemoryIds
			if ids.contains(memory.id) {
				ids.remove(memory.id)
			} else {
				ids.insert(memory.id)
			}
			store.selectMemories(ids: ids)
			if ids.count == 1 {
				Task { await store.loadSelectedMemory() }
			}
		} else {
			Task { await store.selectMemory(id: memory.id) }
		}
	}
}

struct MemoryListRow: View {
	let memory: MemoryItem
	let isSelected: Bool

	var body: some View {
		HStack(alignment: .top, spacing: FeatureBrowserMetrics.rowContentSpacing) {
			FeatureBrowserRowGlyph(systemImage: "brain.head.profile", isSelected: isSelected)
			VStack(alignment: .leading, spacing: 2) {
				Text(memory.value)
					.font(.callout.weight(.medium))
					.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
					.lineLimit(2)
					.multilineTextAlignment(.leading)
				if let subject = memory.subject, !subject.isEmpty {
					Text(subject)
						.font(.caption)
						.foregroundStyle(AppTheme.tertiaryText)
						.lineLimit(1)
				}
			}
			.frame(maxWidth: .infinity, alignment: .leading)
			Text(memory.type)
				.font(.system(size: 9, weight: .semibold))
				.foregroundStyle(AppTheme.tertiaryText)
				.textCase(.uppercase)
			Text(confidenceLabel)
				.font(.system(size: 11, weight: .medium))
				.foregroundStyle(AppTheme.tertiaryText)
				.monospacedDigit()
		}
		.padding(.vertical, FeatureBrowserMetrics.rowVerticalPadding)
		.padding(.horizontal, FeatureBrowserMetrics.rowHorizontalPadding)
		.contentShape(Rectangle())
		.background {
			RoundedRectangle(cornerRadius: FeatureBrowserMetrics.rowCornerRadius)
				.fill(isSelected ? AppTheme.selection : Color.clear)
		}
		.transaction { $0.disablesAnimations = true }
		.accessibilityElement(children: .combine)
		.accessibilityLabel(accessibilityText)
		.accessibilityAddTraits(isSelected ? [.isSelected] : [])
		.accessibilityIdentifier("memory-row-\(memory.id)")
	}

	private var confidenceLabel: String {
		String(format: "%.0f%%", memory.confidence * 100)
	}

	private var accessibilityText: String {
		var parts = [memory.value, memory.type, confidenceLabel]
		if let subject = memory.subject, !subject.isEmpty {
			parts.insert(subject, at: 1)
		}
		return parts.joined(separator: ", ")
	}
}
