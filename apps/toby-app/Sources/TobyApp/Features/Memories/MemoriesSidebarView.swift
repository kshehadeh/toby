import SwiftUI

struct MemoriesSidebarView: View {
	@Bindable var store: MemoriesStore
	let onDelete: (MemoryItem) -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			Button {
				store.startCreate()
			} label: {
				HStack(spacing: 6) {
					Image(systemName: "plus")
					Text("Add Memory")
						.font(.caption)
				}
				.foregroundStyle(AppTheme.secondaryText)
				.frame(maxWidth: .infinity, alignment: .leading)
				.padding(.horizontal, 10)
				.padding(.vertical, 8)
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.accessibilityIdentifier("create-memory-button")
			.padding(.top, 10)

			Divider().overlay(AppTheme.separator).opacity(0.5)

			HStack(spacing: 6) {
				Image(systemName: "magnifyingglass")
					.foregroundStyle(AppTheme.tertiaryText)
				TextField("Search memories…", text: Binding(
					get: { store.searchQuery },
					set: { newValue in
						store.searchQuery = newValue
						Task { await store.search(newValue) }
					},
				))
				.textFieldStyle(.plain)
				.font(.caption)
				.foregroundStyle(AppTheme.primaryText)
			}
			.padding(.horizontal, 10)
			.padding(.vertical, 6)

			Divider().overlay(AppTheme.separator).opacity(0.5)

			ScrollView {
				VStack(alignment: .leading, spacing: 2) {
					if store.isListLoading && store.memories.isEmpty {
						Text("Loading memories…")
							.font(.caption)
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(10)
					} else if store.memories.isEmpty {
						Text("No memories")
							.font(.caption)
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(10)
					} else {
						ForEach(store.memories) { memory in
							Button {
								Task { await store.selectMemory(id: memory.id) }
							} label: {
								MemorySidebarRow(
									memory: memory,
									isSelected: store.selectedMemoryId == memory.id,
								)
							}
							.buttonStyle(.plain)
							.contextMenu {
								Button("Delete Memory", systemImage: "trash", role: .destructive) {
									onDelete(memory)
								}
							}
						}
					}
				}
				.frame(maxWidth: .infinity, alignment: .leading)
				.padding(10)
			}
			.background(AppTheme.sidebarBackground)
		}
	}
}

struct MemorySidebarRow: View {
	let memory: MemoryItem
	let isSelected: Bool

	var body: some View {
		HStack(alignment: .top, spacing: 8) {
			Image(systemName: "brain.head.profile")
				.font(.system(size: 12))
				.foregroundStyle(isSelected ? AppTheme.accent : AppTheme.tertiaryText)
				.frame(width: 16, height: 16)
				.padding(.top, 2)
			VStack(alignment: .leading, spacing: 2) {
				Text(memory.value)
					.font(.system(size: 12, weight: .medium))
					.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
					.lineLimit(2)
					.multilineTextAlignment(.leading)
				if let subject = memory.subject, !subject.isEmpty {
					Text(subject)
						.font(.system(size: 10))
						.foregroundStyle(AppTheme.tertiaryText)
						.lineLimit(1)
				}
			}
			.frame(maxWidth: .infinity, alignment: .leading)
			Text(memory.type)
				.font(.system(size: 9, weight: .medium))
				.foregroundStyle(AppTheme.tertiaryText)
				.textCase(.uppercase)
		}
		.padding(.horizontal, 8)
		.padding(.vertical, 6)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(
			RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
				.fill(isSelected ? AppTheme.selection : Color.clear)
		)
		.contentShape(RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius))
	}
}
