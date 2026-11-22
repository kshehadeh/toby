import SwiftUI

/// "Guide The Feed": write instructions for what The Feed includes and how it
/// ranks, and review, turn off, or delete past ones. Opened from the Home
/// toolbar and the Feed card menu.
struct FeedInstructionsSheet: View {
	@Bindable var store: FeedInstructionsStore
	let onDone: () -> Void

	@State private var draft = ""
	@FocusState private var isComposerFocused: Bool

	static let title = "Guide The Feed"
	static let examples = "For example: “Put anything from my manager first” or “Leave out GitHub notifications.”"

	private var trimmedDraft: String {
		draft.trimmingCharacters(in: .whitespacesAndNewlines)
	}

	private var canAdd: Bool {
		!trimmedDraft.isEmpty && trimmedDraft.count <= FeedInstruction.maxLength && !store.isSaving
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			header
				.padding(20)
			composer
				.padding(.horizontal, 20)
				.padding(.bottom, 16)
			Divider()
			instructionList
			Divider()
			footer
				.padding(.horizontal, 20)
				.padding(.vertical, 12)
		}
		.frame(width: 520, height: 520)
		.background(AppTheme.contentBackground)
		.task { await store.load() }
		.onAppear { isComposerFocused = true }
		.accessibilityIdentifier("feed-instructions-sheet")
	}

	private var header: some View {
		VStack(alignment: .leading, spacing: 4) {
			Text(Self.title)
				.font(.system(size: 17, weight: .semibold))
				.foregroundStyle(AppTheme.primaryText)
			Text("Tell The Feed what to include, what to leave out, and what matters most. Instructions apply the next time The Feed updates.")
				.font(.system(size: 12))
				.foregroundStyle(AppTheme.secondaryText)
				.fixedSize(horizontal: false, vertical: true)
		}
	}

	private var composer: some View {
		VStack(alignment: .leading, spacing: 6) {
			HStack(alignment: .bottom, spacing: 8) {
				TextField("New instruction", text: $draft, axis: .vertical)
					.lineLimit(2 ... 5)
					.textFieldStyle(.roundedBorder)
					.focused($isComposerFocused)
					.onSubmit(addDraft)
					.accessibilityIdentifier("feed-instruction-field")
				Button("Add", action: addDraft)
					.buttonStyle(.borderedProminent)
					.disabled(!canAdd)
					.keyboardShortcut(.return, modifiers: .command)
					.help("Add instruction (⌘↩)")
					.accessibilityIdentifier("feed-instruction-add")
			}
			if trimmedDraft.count > FeedInstruction.maxLength {
				Text("Keep instructions under \(FeedInstruction.maxLength) characters.")
					.font(.system(size: 11))
					.foregroundStyle(AppTheme.statusErrorForeground)
			} else {
				Text(Self.examples)
					.font(.system(size: 11))
					.foregroundStyle(AppTheme.tertiaryText)
			}
		}
	}

	@ViewBuilder
	private var instructionList: some View {
		if store.instructions.isEmpty {
			VStack(spacing: 6) {
				if store.isLoading {
					ProgressView()
						.controlSize(.small)
						.accessibilityLabel("Loading instructions")
				} else {
					Text("No instructions yet")
						.font(.system(size: 13, weight: .medium))
						.foregroundStyle(AppTheme.secondaryText)
					Text("The Feed uses its default rules, your memories, and items you mark Not relevant.")
						.font(.system(size: 12))
						.foregroundStyle(AppTheme.tertiaryText)
						.multilineTextAlignment(.center)
				}
			}
			.padding(24)
			.frame(maxWidth: .infinity, maxHeight: .infinity)
		} else {
			ScrollView {
				LazyVStack(alignment: .leading, spacing: 0) {
					ForEach(store.instructions) { instruction in
						FeedInstructionRow(
							instruction: instruction,
							isDisabled: store.isSaving,
							onToggle: { enabled in
								Task { await store.setEnabled(instruction, enabled: enabled) }
							},
							onDelete: {
								Task { await store.delete(instruction) }
							}
						)
						if instruction.id != store.instructions.last?.id {
							Divider().padding(.leading, 20)
						}
					}
				}
			}
			.frame(maxWidth: .infinity, maxHeight: .infinity)
		}
	}

	private var footer: some View {
		HStack(spacing: 8) {
			if let error = store.error {
				Label(error, systemImage: "exclamationmark.triangle")
					.font(.system(size: 11))
					.foregroundStyle(AppTheme.statusErrorForeground)
					.lineLimit(2)
			} else if !store.instructions.isEmpty {
				Text("\(store.enabledCount) of \(store.instructions.count) on")
					.font(.system(size: 11))
					.foregroundStyle(AppTheme.tertiaryText)
			}
			Spacer(minLength: 0)
			Button("Done", action: onDone)
				.keyboardShortcut(.cancelAction)
				.accessibilityIdentifier("feed-instructions-done")
		}
	}

	private func addDraft() {
		guard canAdd else { return }
		let text = trimmedDraft
		Task {
			if await store.add(text) {
				draft = ""
			}
		}
	}
}

/// One past instruction: on/off switch, text, date added, delete.
struct FeedInstructionRow: View {
	let instruction: FeedInstruction
	var isDisabled = false
	let onToggle: (Bool) -> Void
	let onDelete: () -> Void

	private var addedText: String? {
		DashboardDate.parse(instruction.createdAt).map {
			"Added \($0.formatted(date: .abbreviated, time: .omitted))"
		}
	}

	var body: some View {
		HStack(alignment: .top, spacing: 12) {
			Toggle(
				"Use this instruction",
				isOn: Binding(get: { instruction.enabled }, set: { onToggle($0) })
			)
			.labelsHidden()
			.toggleStyle(.switch)
			.controlSize(.mini)
			.disabled(isDisabled)
			.help(instruction.enabled ? "Turn off" : "Turn on")
			.accessibilityIdentifier("feed-instruction-toggle-\(instruction.id)")
			VStack(alignment: .leading, spacing: 3) {
				Text(instruction.text)
					.font(.system(size: 13))
					.foregroundStyle(instruction.enabled ? AppTheme.primaryText : AppTheme.tertiaryText)
					.fixedSize(horizontal: false, vertical: true)
					.textSelection(.enabled)
				if instruction.enabled, let caption = instruction.enforcementCaption {
					Text(caption)
						.font(.system(size: 11))
						.foregroundStyle(AppTheme.secondaryText)
						.fixedSize(horizontal: false, vertical: true)
						.accessibilityIdentifier("feed-instruction-enforcement-\(instruction.id)")
				}
				if let addedText {
					Text(instruction.enabled ? addedText : "\(addedText) · Off")
						.font(.system(size: 11))
						.foregroundStyle(AppTheme.tertiaryText)
				}
			}
			Spacer(minLength: 0)
			Button(action: onDelete) {
				Image(systemName: "trash")
					.font(.system(size: 12))
					.foregroundStyle(AppTheme.tertiaryText)
					.contentShape(Rectangle())
			}
			.buttonStyle(.borderless)
			.disabled(isDisabled)
			.help("Delete instruction")
			.accessibilityLabel("Delete instruction")
			.accessibilityIdentifier("feed-instruction-delete-\(instruction.id)")
		}
		.padding(.horizontal, 20)
		.padding(.vertical, 10)
		.accessibilityIdentifier("feed-instruction-\(instruction.id)")
	}
}
