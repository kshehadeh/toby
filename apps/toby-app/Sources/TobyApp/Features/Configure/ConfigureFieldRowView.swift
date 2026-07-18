import SwiftUI

struct ConfigureFieldRowView: View {
	@Bindable var store: ConfigureStore
	let field: SettingsItem
	let sectionLabel: String
	let showsDivider: Bool

	var body: some View {
		SettingsRow(
			title: field.label,
			description: fieldDescription,
			showsDivider: showsDivider,
		) {
			fieldControl
		}
	}

	@ViewBuilder
	private var fieldControl: some View {
		switch field.kind {
		case .action:
			if let action = ConfigureTreeHelpers.actionForKey(field.key) {
				SettingsActionButton(title: actionButtonTitle, showsExternalIcon: false) {
					Task { await store.runAction(action.name, body: action.body) }
				}
				.disabled(store.isSaving)
			}
		case .select:
			if let options = field.options, !options.isEmpty {
				if ConfigureTreeHelpers.isBooleanSelectField(field) {
					SettingsToggle(isOn: booleanBinding)
				} else {
					selectField(options: options)
				}
			}
		case .multiSelect:
			multiSelectMenu
		default:
			if field.masked == true {
				SettingsInlineField(
					text: maskedDraftBinding,
					isSecure: true,
					placeholder: maskedPlaceholder,
				)
			} else if field.kind == .value || field.kind == .select {
				SettingsInlineField(text: draftBinding, placeholder: "Enter value")
			} else if field.readOnly == true {
				Text(store.value(for: field.key).isEmpty ? "Not set" : "Configured")
					.font(.body)
					.foregroundStyle(SettingsDesign.rowDescription)
			}
		}
	}

	private var actionButtonTitle: String {
		switch field.key {
		case "personas._new", "schedules._new":
			return "Create"
		default:
			if field.key.hasSuffix("._setDefault") {
				return "Set Default"
			}
			return field.label
		}
	}

	private var fieldDescription: String? {
		if field.masked == true,
			store.value(for: field.key) == ConfigureConstants.redactedSecret,
			store.draft[field.key] == nil
		{
			return "A value is saved. Enter a new value to replace it."
		}
		if field.kind == .select, ConfigureTreeHelpers.isBooleanSelectField(field) {
			return booleanBinding.wrappedValue
				? "This setting is currently enabled."
				: "This setting is currently disabled."
		}
		// Server-provided field copy (e.g. dashboard persona guidance).
		if let description = field.description, !description.isEmpty {
			return description
		}
		return nil
	}

	private var maskedPlaceholder: String {
		if store.value(for: field.key) == ConfigureConstants.redactedSecret,
			store.draft[field.key] == nil
		{
			return "••••••"
		}
		return "Enter value"
	}

	private func selectField(options: [String]) -> some View {
		SettingsSelectChoiceField(
			title: field.label,
			choices: selectOptions(options),
			selection: selectBinding,
		)
		.fixedSize()
	}

	private var multiSelectMenu: some View {
		let choices = field.selectChoices ?? field.options?.map {
			SettingsSelectChoice(value: $0, label: $0)
		} ?? []
		return Menu {
			ForEach(choices, id: \.value) { choice in
				Button {
					toggleMultiSelectValue(choice.value)
				} label: {
					if multiSelectValues.contains(choice.value) {
						Label(choice.label, systemImage: "checkmark")
					} else {
						Text(choice.label)
					}
				}
			}
		} label: {
			Text(multiSelectSummary(from: choices))
		}
		.fixedSize()
	}

	private var multiSelectValues: Set<String> {
		let raw = store.draft[field.key] ?? store.savedValues[field.key] ?? ""
		return Set(
			raw.split(separator: ",")
				.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
				.filter { !$0.isEmpty },
		)
	}

	private func toggleMultiSelectValue(_ value: String) {
		var next = multiSelectValues
		if next.contains(value) {
			next.remove(value)
		} else {
			next.insert(value)
		}
		store.setDraftValue(field.key, next.sorted().joined(separator: ","), autosaveImmediately: true)
	}

	private func multiSelectSummary(from choices: [SettingsSelectChoice]) -> String {
		let selected = choices.filter { multiSelectValues.contains($0.value) }
		if selected.isEmpty { return "None" }
		if selected.count == 1 { return selected[0].label }
		return "\(selected.count) selected"
	}

	private func currentSelectLabel(options: [String]) -> String {
		let value = store.value(for: field.key)
		return selectOptions(options).first(where: { $0.value == value })?.label ?? value
	}

	private var booleanBinding: Binding<Bool> {
		let options = Set(field.options?.map { $0.lowercased() } ?? [])
		let trueFalse = options == ["true", "false"]
		return Binding(
			get: {
				let value = store.value(for: field.key).lowercased()
				return value == "yes" || value == "true"
			},
			set: { enabled in
				if trueFalse {
					store.setDraftValue(field.key, enabled ? "true" : "false", autosaveImmediately: true)
				} else {
					store.setDraftValue(field.key, enabled ? "Yes" : "No", autosaveImmediately: true)
				}
			},
		)
	}

	private var draftBinding: Binding<String> {
		Binding(
			get: { store.value(for: field.key) },
			set: { store.setDraftValue(field.key, $0) },
		)
	}

	private var selectBinding: Binding<String> {
		Binding(
			get: { store.value(for: field.key) },
			set: { store.setDraftValue(field.key, $0, autosaveImmediately: true) },
		)
	}

	private var maskedDraftBinding: Binding<String> {
		Binding(
			get: {
				if let draftValue = store.draft[field.key] {
					return draftValue
				}
				let saved = store.savedValues[field.key] ?? ""
				return saved == ConfigureConstants.redactedSecret ? "" : saved
			},
			// Save secrets immediately so a provider switch / section reload cannot
			// drop a key that was only queued on the delayed autosave timer.
			set: { store.setDraftValue(field.key, $0, autosaveImmediately: true) },
		)
	}

	private func selectOptions(_ options: [String]) -> [SettingsSelectChoice] {
		if let choices = field.selectChoices, !choices.isEmpty {
			return choices
		}
		return options.map { option in
			let label = store.integrationLabels[option] ?? option
			return SettingsSelectChoice(value: option, label: label)
		}
	}
}
