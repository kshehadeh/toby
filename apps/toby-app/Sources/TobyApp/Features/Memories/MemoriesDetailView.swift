import SwiftUI

struct MemoriesDetailView: View {
	@Bindable var store: MemoriesStore
	@State private var draftType = "fact"
	@State private var draftSubject = ""
	@State private var draftValue = ""
	@State private var draftConfidence = 1.0
	@State private var draftSensitivity = "normal"
	@State private var draftVisibility = "usable_by_ai"

	var body: some View {
		Group {
			if store.isListLoading && store.memories.isEmpty && !store.isCreatingNew {
				ProgressView("Loading memories…")
					.frame(maxWidth: .infinity, maxHeight: .infinity)
			} else if let errorMessage = store.errorMessage, store.memories.isEmpty, !store.isCreatingNew {
				ContentUnavailableView {
					Label("Memories unavailable", systemImage: "exclamationmark.triangle")
				} description: {
					Text(errorMessage)
				}
			} else if store.memories.isEmpty && !store.isCreatingNew {
				MemoriesEmptyStateView(store: store) {
					store.startCreate()
				}
			} else {
				contentSplit
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(SettingsDesign.canvasBackground)
		.onChange(of: store.isCreatingNew) { _, isCreating in
			if isCreating { resetDraft() }
		}
		.onChange(of: store.selectedMemory?.id, initial: true) { _, _ in
			if let memory = store.selectedMemory {
				resetDraft(from: memory)
			}
		}
	}

	private var contentSplit: some View {
		HStack(spacing: 0) {
			memoryTable
				.frame(maxWidth: .infinity, maxHeight: .infinity)
			Divider().overlay(SettingsDesign.cardBorder)
			editorPanel
				.frame(width: 340)
				.frame(maxHeight: .infinity)
		}
	}

	private var memoryTable: some View {
		VStack(spacing: 0) {
			HStack {
				Text("Memories")
					.font(.system(size: 15, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)
				Spacer()
				Text("\(store.memories.count)\(store.hasMore ? "+" : "") of \(store.total)")
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
				Button {
					store.startCreate()
				} label: {
					Label("New", systemImage: "plus")
						.font(.caption)
				}
				.buttonStyle(.bordered)
				.controlSize(.small)
				.disabled(store.isSaving)
				.accessibilityIdentifier("new-memory-button")
			}
			.padding(.horizontal, 16)
			.padding(.vertical, 10)
			Divider().overlay(SettingsDesign.cardBorder)
			Table(store.memories, selection: Binding(
				get: { store.selectedMemoryId },
				set: { newId in
					store.cancelCreate()
					if let newId {
						Task { await store.selectMemory(id: newId) }
					} else {
						store.selectedMemoryId = nil
						store.selectedMemory = nil
					}
				},
			)) {
				TableColumn("Value") { memory in
					Text(memory.value)
						.lineLimit(2)
						.font(.system(size: 12))
				}
				.width(min: 120, ideal: 220)
				TableColumn("Type") { memory in
					Text(memory.type)
						.font(.system(size: 11))
						.foregroundStyle(AppTheme.secondaryText)
				}
				.width(min: 70, ideal: 90)
				TableColumn("Sensitivity") { memory in
					Text(memory.sensitivity)
						.font(.system(size: 11))
						.foregroundStyle(sensitivityColor(memory.sensitivity))
				}
				.width(min: 70, ideal: 90)
				TableColumn("Visibility") { memory in
					Text(memory.visibility)
						.font(.system(size: 11))
						.foregroundStyle(AppTheme.secondaryText)
				}
				.width(min: 90, ideal: 120)
				TableColumn("Updated") { memory in
					Text(shortDate(memory.updatedAt))
						.font(.system(size: 11))
						.foregroundStyle(AppTheme.tertiaryText)
				}
				.width(min: 80, ideal: 100)
			}
			.tableStyle(.inset)
			.frame(maxWidth: .infinity, maxHeight: .infinity)
			if let errorMessage = store.errorMessage, !store.memories.isEmpty {
				Text(errorMessage)
					.font(.caption)
					.foregroundStyle(.red)
					.frame(maxWidth: .infinity, alignment: .leading)
					.padding(.horizontal, 16)
					.padding(.bottom, 8)
			}
		}
	}

	@ViewBuilder
	private var editorPanel: some View {
		if store.isCreatingNew {
			memoryEditor(
				title: "New Memory",
				memory: nil,
				isSaving: store.isSaving,
				hasChanges: hasUnsavedChanges,
				onSave: {
					Task {
						let success = await store.createMemory(
							type: draftType,
							subject: draftSubject,
							value: draftValue,
							confidence: draftConfidence,
							sensitivity: draftSensitivity,
							visibility: draftVisibility
						)
						if success { store.cancelCreate() }
					}
				},
				onCancel: { store.cancelCreate() },
				onDelete: nil
			)
		} else if let memory = store.selectedMemory {
			memoryEditor(
				title: "Edit Memory",
				memory: memory,
				isSaving: store.isSaving,
				hasChanges: hasUnsavedChanges,
				onSave: {
					Task { await store.updateMemory(
						id: memory.id,
						type: draftType,
						subject: draftSubject,
						value: draftValue,
						confidence: draftConfidence,
						sensitivity: draftSensitivity,
						visibility: draftVisibility
					) }
				},
				onCancel: { resetDraft(from: memory) },
				onDelete: { store.pendingDelete = MemoriesStore.PendingDelete(id: memory.id, value: memory.value) }
			)
		} else {
			VStack(spacing: 10) {
				Image(systemName: "brain.head.profile")
					.font(.system(size: 40))
					.foregroundStyle(AppTheme.tertiaryText)
				Text("Select a memory to edit")
					.font(.callout)
					.foregroundStyle(AppTheme.secondaryText)
			}
			.frame(maxWidth: .infinity, maxHeight: .infinity)
		}
	}

	private func resetDraft() {
		draftType = "fact"
		draftSubject = ""
		draftValue = ""
		draftConfidence = 1.0
		draftSensitivity = "normal"
		draftVisibility = "usable_by_ai"
	}

	private func resetDraft(from memory: MemoryItem) {
		draftType = memory.type
		draftSubject = memory.subject ?? ""
		draftValue = memory.value
		draftConfidence = memory.confidence
		draftSensitivity = memory.sensitivity
		draftVisibility = memory.visibility
	}

	private var hasUnsavedChanges: Bool {
		if store.isCreatingNew {
			return !draftValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
				!draftSubject.isEmpty ||
				draftType != "fact" ||
				draftConfidence != 1.0 ||
				draftSensitivity != "normal" ||
				draftVisibility != "usable_by_ai"
		} else if let memory = store.selectedMemory {
			return draftType != memory.type ||
				draftSubject != (memory.subject ?? "") ||
				draftValue != memory.value ||
				draftConfidence != memory.confidence ||
				draftSensitivity != memory.sensitivity ||
				draftVisibility != memory.visibility
		}
		return false
	}

	private func sensitivityColor(_ sensitivity: String) -> Color {
		switch sensitivity {
		case "restricted": .red
		case "sensitive": .orange
		default: AppTheme.secondaryText
		}
	}

	private func shortDate(_ iso: String) -> String {
		let formatter = ISO8601DateFormatter()
		formatter.formatOptions = [.withInternetDateTime]
		guard let date = formatter.date(from: iso) else { return iso }
		let display = DateFormatter()
		display.dateStyle = .short
		display.timeStyle = .short
		return display.string(from: date)
	}
}

private struct MemoriesEmptyStateView: View {
	@Bindable var store: MemoriesStore
	let onCreate: () -> Void

	var body: some View {
		VStack(spacing: 18) {
			Image(systemName: "brain.head.profile")
				.font(.system(size: 72, weight: .regular))
				.foregroundStyle(SettingsDesign.rowDescription)
				.accessibilityHidden(true)

			VStack(spacing: 8) {
				Text("Memories")
					.font(.system(size: 28, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)

				Text("Memories are durable facts Toby remembers across chats. Create one manually, or let Toby propose memories during conversations.")
					.font(.body)
					.foregroundStyle(SettingsDesign.rowDescription)
					.multilineTextAlignment(.center)
					.lineLimit(4)
					.frame(maxWidth: 480)
			}

			Button {
				onCreate()
			} label: {
				Label("Create Memory", systemImage: "plus")
			}
			.buttonStyle(.borderedProminent)
			.disabled(store.isListLoading || store.isSaving)
			.accessibilityIdentifier("empty-create-memory-button")
		}
		.padding(32)
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.accessibilityElement(children: .contain)
	}
}

private extension MemoriesDetailView {
	@ViewBuilder
	func memoryEditor(
		title: String,
		memory: MemoryItem?,
		isSaving: Bool,
		hasChanges: Bool,
		onSave: @escaping () -> Void,
		onCancel: @escaping () -> Void,
		onDelete: (() -> Void)?
	) -> some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 16) {
				HStack(spacing: 10) {
					Image(systemName: "brain.head.profile")
						.font(.system(size: 20))
						.foregroundStyle(AppTheme.accent)
					Text(title)
						.font(.system(size: 16, weight: .semibold))
						.foregroundStyle(AppTheme.primaryText)
					Spacer()
				}

				SettingsCard {
					VStack(spacing: 0) {
						// Subject: label above, full-width field
						editorFieldLabel("Subject", subtitle: "Optional label")
						TextField("Subject", text: $draftSubject)
							.textFieldStyle(.roundedBorder)
							.padding(.horizontal, 10)
							.padding(.bottom, 10)
						divider

						// Value: label above, full-width field
						editorFieldLabel("Value")
						TextField("Value", text: $draftValue, axis: .vertical)
							.textFieldStyle(.roundedBorder)
							.lineLimit(3...8)
							.padding(.horizontal, 10)
							.padding(.bottom, 10)
						divider

						// Type: horizontal, right-aligned control
						editorInlineRow("Type") {
							Picker("Type", selection: $draftType) {
								ForEach(MemoryField.memoryTypes, id: \.self) { Text($0).tag($0) }
							}
							.labelsHidden()
							.pickerStyle(.menu)
							.frame(width: 160)
						}
						divider

						// Sensitivity: horizontal, right-aligned control
						editorInlineRow("Sensitivity") {
							Picker("Sensitivity", selection: $draftSensitivity) {
								ForEach(MemoryField.memorySensitivities, id: \.self) { Text($0).tag($0) }
							}
							.labelsHidden()
							.pickerStyle(.menu)
							.frame(width: 160)
						}
						divider

						// Visibility: horizontal, right-aligned control
						editorInlineRow("Visibility") {
							Picker("Visibility", selection: $draftVisibility) {
								ForEach(MemoryField.memoryVisibilities, id: \.self) { Text($0).tag($0) }
							}
							.labelsHidden()
							.pickerStyle(.menu)
							.frame(width: 160)
						}
						divider

						// Confidence: horizontal, right-aligned control
						editorInlineRow("Confidence") {
							HStack(spacing: 8) {
								Text(String(format: "%.0f%%", draftConfidence * 100))
									.font(.system(size: 11, weight: .medium))
									.foregroundStyle(AppTheme.secondaryText)
									.frame(width: 36, alignment: .trailing)
								Slider(value: $draftConfidence, in: 0...1, step: 0.05)
									.frame(width: 116)
							}
						}
					}
				}

				if let memory {
					VStack(alignment: .leading, spacing: 4) {
						Text("Created \(memory.createdAt)")
							.font(.system(size: 10))
							.foregroundStyle(AppTheme.tertiaryText)
						Text("Updated \(memory.updatedAt)")
							.font(.system(size: 10))
							.foregroundStyle(AppTheme.tertiaryText)
					}
					.padding(.horizontal, 4)
				}

				HStack(spacing: 8) {
					Button {
						onSave()
					} label: {
						Label("Save", systemImage: "checkmark.circle.fill")
					}
					.buttonStyle(.borderedProminent)
					.disabled(isSaving || !hasChanges)
					.accessibilityIdentifier("save-memory-button")

					Button("Cancel") { onCancel() }
						.buttonStyle(.bordered)
						.disabled(isSaving || (memory != nil && !hasChanges))

					Spacer()

					if let onDelete {
						Button(role: .destructive) {
							onDelete()
						} label: {
							Label("Delete", systemImage: "trash")
						}
						.buttonStyle(.bordered)
						.disabled(isSaving)
						.accessibilityIdentifier("delete-memory-button")
					}
				}
				.padding(.horizontal, 4)
			}
			.padding(20)
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.background(SettingsDesign.canvasBackground)
	}

	private var divider: some View {
		Rectangle()
			.fill(SettingsDesign.cardBorder)
			.frame(height: 1)
			.padding(.leading, 10)
	}

	private func editorFieldLabel(_ title: String, subtitle: String? = nil) -> some View {
		HStack(spacing: 4) {
			Text(title)
				.font(.system(size: 13, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
				.fixedSize()
			if let subtitle {
				Text(subtitle)
					.font(.system(size: 11))
					.foregroundStyle(SettingsDesign.rowDescription)
					.fixedSize()
			}
		}
		.frame(maxWidth: .infinity, alignment: .leading)
		.padding(.horizontal, 10)
		.padding(.top, 10)
		.padding(.bottom, 6)
	}

	@ViewBuilder
	private func editorInlineRow<Control: View>(_ label: String, @ViewBuilder control: () -> Control) -> some View {
		HStack(alignment: .center, spacing: 16) {
			Text(label)
				.font(.system(size: 13, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
				.fixedSize()
			Spacer(minLength: 0)
			control()
		}
		.padding(.horizontal, 10)
		.padding(.vertical, 8)
		.frame(minHeight: SettingsDesign.formRowHeight)
	}
}
