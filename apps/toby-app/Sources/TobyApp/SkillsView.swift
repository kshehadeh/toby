import SwiftUI

struct SkillsView: View {
	@Bindable var store: SkillsStore
	@State private var isDeleteAlertPresented = false
	@State private var columnVisibility: NavigationSplitViewVisibility = .all

	var body: some View {
		NavigationSplitView(columnVisibility: $columnVisibility) {
			SkillsSidebarView(store: store, onDelete: confirmDelete)
				.navigationSplitViewColumnWidth(AppTheme.sidebarWidth)
		} detail: {
			SkillsDetailView(store: store, onDelete: confirmDeleteSelected)
		}
		.toolbarBackground(.visible)
		.frame(minWidth: 860, minHeight: 560)
		.background(SettingsDesign.canvasBackground)
		.task {
			await store.load()
		}
		.onDisappear {
			Task { await store.flushPendingSave() }
		}
		.alert(
			"Delete Skill?",
			isPresented: $isDeleteAlertPresented,
			presenting: store.pendingDelete,
		) { pending in
			Button("Cancel", role: .cancel) {
				store.pendingDelete = nil
			}
			Button("Delete", role: .destructive) {
				store.pendingDelete = nil
				Task { await store.deleteSkill(id: pending.dirName) }
			}
		} message: { pending in
			Text("Are you sure you want to delete \"\(pending.name)\"? This cannot be undone.")
		}
	}

	private func confirmDelete(_ item: SkillListItem) {
		store.pendingDelete = SkillsStore.PendingDelete(dirName: item.dirName, name: item.name)
		isDeleteAlertPresented = true
	}

	private func confirmDeleteSelected() {
		guard let skill = store.selectedSkill else { return }
		store.pendingDelete = SkillsStore.PendingDelete(dirName: skill.dirName, name: skill.name)
		isDeleteAlertPresented = true
	}
}

private struct SkillsSidebarView: View {
	@Bindable var store: SkillsStore
	let onDelete: (SkillListItem) -> Void

	var body: some View {
		VStack(spacing: 0) {
			ScrollView {
				VStack(alignment: .leading, spacing: 2) {
					if store.isListLoading && store.skills.isEmpty {
						Text("Loading skills…")
							.font(.caption)
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(10)
					} else if store.skills.isEmpty {
						Text("No skills")
							.font(.caption)
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(10)
					} else {
						ForEach(store.skills) { skill in
							Button {
								Task { await store.selectSkill(id: skill.id) }
							} label: {
								SkillSidebarRow(
									skill: skill,
									isSelected: store.selectedSkillId == skill.id,
								)
							}
							.buttonStyle(.plain)
							.contextMenu {
								Button("Delete Skill", systemImage: "trash", role: .destructive) {
									onDelete(skill)
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
		.toolbar {
			ToolbarItem(placement: .confirmationAction) {
				Button {
					Task { await store.createSkill() }
				} label: {
					Image(systemName: "plus")
				}
				.help("Create Skill")
				.disabled(store.isListLoading || store.isSaving)
			}
		}
	}
}

private struct SkillSidebarRow: View {
	let skill: SkillListItem
	let isSelected: Bool

	var body: some View {
		HStack(spacing: 12) {
			Image(systemName: "wand.and.stars")
				.font(.system(size: 14, weight: .semibold))
				.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.tertiaryText)
				.frame(width: 20, height: 20)
			VStack(alignment: .leading, spacing: 2) {
				Text(skill.name)
					.font(.callout.weight(.medium))
					.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
					.lineLimit(1)
				if let description = skill.description, !description.isEmpty {
					Text(description)
						.font(.caption)
						.foregroundStyle(AppTheme.tertiaryText)
						.lineLimit(1)
				}
			}
			Spacer(minLength: 0)
		}
		.padding(.vertical, 8)
		.padding(.horizontal, 10)
		.contentShape(Rectangle())
		.background(
			RoundedRectangle(cornerRadius: 8)
				.fill(isSelected ? Color.white.opacity(0.10) : Color.clear)
		)
	}
}

private struct SkillsDetailView: View {
	@Bindable var store: SkillsStore
	let onDelete: () -> Void

	var body: some View {
		GeometryReader { geo in
			ScrollView {
				VStack(alignment: .leading, spacing: 20) {
					if store.isListLoading && store.skills.isEmpty {
						ProgressView("Loading skills…")
							.frame(maxWidth: .infinity, minHeight: 240)
					} else if let skill = store.selectedSkill {
						SkillDetailContent(store: store, skill: skill, availableHeight: geo.size.height)
					} else if let errorMessage = store.errorMessage, store.skills.isEmpty {
						ContentUnavailableView {
							Label("Skills unavailable", systemImage: "exclamationmark.triangle")
						} description: {
							Text(errorMessage)
						}
					} else {
						Text("Select a skill")
							.foregroundStyle(SettingsDesign.rowDescription)
					}

					if let errorMessage = store.errorMessage, !store.skills.isEmpty {
						Text(errorMessage)
							.font(.caption)
							.foregroundStyle(.red)
					}
				}
				.frame(maxWidth: SettingsDesign.contentMaxWidth)
				.frame(maxWidth: .infinity)
				.padding(.horizontal, 32)
				.padding(.vertical, 28)
			}
		}
		.background(SettingsDesign.canvasBackground)
		.toolbar {
			ToolbarItem(placement: .primaryAction) {
				if store.selectedSkill != nil {
					Button {
						onDelete()
					} label: {
						Image(systemName: "trash")
					}
					.buttonStyle(.borderedProminent)
					.tint(.red)
					.disabled(store.isSaving)
					.accessibilityIdentifier("delete-skill-button")
				}
			}
		}
	}
}

private struct SkillDetailContent: View {
	@Bindable var store: SkillsStore
	let skill: SkillDetail
	let availableHeight: CGFloat

	var body: some View {
		VStack(alignment: .leading, spacing: 20) {
			SkillDetailHeader(skill: skill)

			SettingsSectionHeader(title: "Details")
			SettingsCard {
				SkillFieldRow(title: "Name") {
					SettingsInlineField(text: binding(for: .name), placeholder: "Skill name")
				}
				SkillFieldRow(title: "Description") {
					SettingsInlineField(text: binding(for: .description), placeholder: "Short description")
				}
				SkillFieldRow(title: "Summary", showsDivider: false) {
					SettingsInlineField(text: binding(for: .summary), placeholder: "Optional summary")
				}
			}

			SettingsSectionHeader(title: "Description")
			MarkdownEditor(text: binding(for: .body))
				.frame(minHeight: max(240, availableHeight - 300), maxHeight: .infinity)
		}
	}

	private func binding(for field: SkillField) -> Binding<String> {
		Binding(
			get: { store.value(for: store.key(for: skill.dirName, field: field)) },
			set: { store.setDraftValue(store.key(for: skill.dirName, field: field), $0) },
		)
	}
}

private struct SkillDetailHeader: View {
	let skill: SkillDetail

	var body: some View {
		HStack(spacing: 14) {
			RoundedRectangle(cornerRadius: 12)
				.fill(AppTheme.accent.opacity(0.18))
				.frame(width: 48, height: 48)
				.overlay {
					Image(systemName: "wand.and.stars")
						.font(.system(size: 22, weight: .medium))
						.foregroundStyle(AppTheme.accent)
				}
			VStack(alignment: .leading, spacing: 4) {
				Text(skill.name)
					.font(.title3.weight(.semibold))
					.foregroundStyle(AppTheme.primaryText)
				if !skill.description.isEmpty {
					Text(skill.description)
						.font(.subheadline)
						.foregroundStyle(AppTheme.secondaryText)
						.lineLimit(2)
				}
			}
		}
	}
}

private struct SkillFieldRow<Control: View>: View {
	let title: String
	var showsDivider: Bool = true
	@ViewBuilder let control: Control

	var body: some View {
		VStack(spacing: 0) {
			HStack(alignment: .center, spacing: 16) {
				Text(title)
					.font(.body)
					.foregroundStyle(SettingsDesign.rowTitle)
					.frame(maxWidth: .infinity, alignment: .leading)

				control
					.layoutPriority(1)
			}
			.padding(.horizontal, SettingsDesign.rowHorizontalPadding)
			.padding(.vertical, SettingsDesign.rowVerticalPadding)

			if showsDivider {
				Rectangle()
					.fill(SettingsDesign.cardBorder)
					.frame(height: 1)
					.padding(.leading, SettingsDesign.rowHorizontalPadding)
			}
		}
	}
}

extension SkillsStore {
	func key(for dirName: String, field: SkillField) -> String {
		"\(dirName).\(field.rawValue)"
	}
}
