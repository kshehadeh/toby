import SwiftUI

/// Catalog of personas for the Settings window. Selecting a row pushes the
/// editor in a `NavigationStack` while the sidebar stays on Personas.
struct PersonasSettingsView: View {
	@Bindable var store: ConfigureStore
	@Binding var path: [String]

	@State private var personas: [PersonaOption]
	@State private var editorStore: PersonaEditorStore?
	@State private var isLoading: Bool
	@State private var isRefreshing = false
	@State private var listErrorMessage: String?
	@State private var pendingDelete: PersonaOption?

	private let client = TobyClient()

	init(
		store: ConfigureStore,
		path: Binding<[String]>,
		initialPersonas: [PersonaOption] = []
	) {
		self.store = store
		self._path = path
		_personas = State(initialValue: initialPersonas)
		_isLoading = State(initialValue: initialPersonas.isEmpty)
	}

	var body: some View {
		NavigationStack(path: $path) {
			catalog
				.navigationDestination(for: String.self) { key in
					personaDetail(for: key)
						.navigationBarBackButtonHidden(true)
						.navigationTitle(PersonasSettingsNavigation.title(for: key))
				}
		}
		.task {
			await loadPersonas()
			consumePendingSelection()
		}
		.onChange(of: path) { _, newPath in
			syncEditor(to: newPath)
		}
		.onChange(of: store.pendingPersonaSelection) { _, _ in
			consumePendingSelection()
		}
		.onReceive(NotificationCenter.default.publisher(for: .personasDidChange)) { _ in
			Task { await loadPersonas() }
		}
		.alert(
			"Delete Persona?",
			isPresented: Binding(
				get: { pendingDelete != nil },
				set: { if !$0 { pendingDelete = nil } },
			),
		) {
			Button("Cancel", role: .cancel) {
				pendingDelete = nil
			}
			Button("Delete", role: .destructive) {
				if let persona = pendingDelete {
					Task { await deletePersona(persona) }
				}
			}
		} message: {
			Text("Are you sure you want to delete \"\(pendingDelete?.label ?? "")\"? This cannot be undone.")
		}
	}

	@ViewBuilder
	private var catalog: some View {
		Group {
			if isLoading && personas.isEmpty {
				ProgressView("Loading personas…")
					.frame(maxWidth: .infinity, maxHeight: .infinity)
			} else if let listErrorMessage, personas.isEmpty {
				ContentUnavailableView {
					Label("Personas unavailable", systemImage: "exclamationmark.triangle")
				} description: {
					Text(listErrorMessage)
				}
			} else {
				catalogForm
			}
		}
		.accessibilityIdentifier("settings-personas-catalog")
	}

	private var catalogForm: some View {
		Form {
			Section {
				SettingsCatalogHeader(
					title: "Personas",
					subtitle: PersonasSettingsNavigation.catalogSubtitle,
					systemImage: "person.crop.circle"
				)
				.frame(maxWidth: .infinity)
				.listRowBackground(Color.clear)
				.listRowInsets(EdgeInsets(top: 12, leading: 0, bottom: 8, trailing: 0))
			}

			Section {
				ForEach(personas) { persona in
					let key = PersonasSettingsNavigation.pathKey(forPersonaName: persona.name)
					NavigationLink(value: key) {
						PersonasCatalogRow(persona: persona)
					}
					.buttonStyle(.plain)
					.accessibilityIdentifier("personas-settings-row-\(persona.name)")
				}
				if personas.isEmpty {
					Text("No personas are available yet.")
						.foregroundStyle(.secondary)
				}
				SettingsCatalogAddRow(
					title: PersonasSettingsNavigation.addTitle,
					accessibilityIdentifier: "personas-settings-add-button",
					action: startCreate
				)
			} header: {
				Text("Personas")
					.accessibilityIdentifier("settings-catalog-group-personas")
			}
		}
		.tobySettingsFormStyle()
		.tobyThemeRefreshable()
	}

	@ViewBuilder
	private func personaDetail(for key: String) -> some View {
		if let currentStore = editorStore, editorMatches(key, store: currentStore) {
			PersonaEditorFormView(
				store: currentStore,
				showDeleteButton: canDelete(currentStore),
				showCancelButton: false,
				showsChromeHeader: false,
				onDelete: {
					if let name = currentStore.mode.editedName,
						let persona = personas.first(where: { $0.name == name })
					{
						pendingDelete = persona
					}
				},
				onSaved: {
					Task { await handleSaved() }
					NotificationCenter.default.post(name: .personasDidChange, object: nil)
				},
				onReset: {}
			)
		} else {
			ProgressView("Loading…")
				.frame(maxWidth: .infinity, maxHeight: .infinity)
				.task(id: key) {
					syncEditor(to: [key])
				}
		}
	}

	private func canDelete(_ editorStore: PersonaEditorStore) -> Bool {
		editorStore.mode.isEdit && !editorStore.isBuiltIn
	}

	private func editorMatches(_ key: String, store: PersonaEditorStore) -> Bool {
		if key == PersonasSettingsNavigation.createKey {
			return store.mode.isCreate
		}
		return store.mode.editedName == PersonasSettingsNavigation.personaName(fromPathKey: key)
	}

	private func startCreate() {
		path = [PersonasSettingsNavigation.createKey]
	}

	private func syncEditor(to path: [String]) {
		guard let key = path.last else {
			editorStore = nil
			return
		}
		if key == PersonasSettingsNavigation.createKey {
			if editorStore?.mode.isCreate != true {
				editorStore = PersonaEditorStore(mode: .create)
			}
			return
		}
		guard let name = PersonasSettingsNavigation.personaName(fromPathKey: key) else {
			editorStore = nil
			return
		}
		if editorStore?.mode.editedName != name {
			editorStore = PersonaEditorStore(mode: .edit(name: name))
		}
	}

	private func handleSaved() async {
		let savedName = editorStore?.name
		let wasCreate = editorStore?.mode.isCreate == true
		await loadPersonas()
		if wasCreate, let savedName, personas.contains(where: { $0.name == savedName }) {
			path = [PersonasSettingsNavigation.pathKey(forPersonaName: savedName)]
		}
	}

	private func deletePersona(_ persona: PersonaOption) async {
		let store = PersonaEditorStore(mode: .edit(name: persona.name))
		await store.load()
		await store.delete()
		if case .saved = store.saveState {
			await loadPersonas()
			if path.last == PersonasSettingsNavigation.pathKey(forPersonaName: persona.name) {
				path = []
				editorStore = nil
			}
			NotificationCenter.default.post(name: .personasDidChange, object: nil)
		} else if let error = store.errorMessage {
			listErrorMessage = error
		}
	}

	private func loadPersonas() async {
		guard !isRefreshing else { return }
		isRefreshing = true
		if personas.isEmpty {
			isLoading = true
		}
		listErrorMessage = nil
		defer {
			isRefreshing = false
			isLoading = false
		}
		do {
			personas = try await client.listPersonas()
		} catch {
			listErrorMessage = error.localizedDescription
		}
	}

	private func consumePendingSelection() {
		guard let name = store.pendingPersonaSelection else { return }
		store.pendingPersonaSelection = nil
		path = [PersonasSettingsNavigation.pathKey(forPersonaName: name)]
	}
}

enum PersonasSettingsNavigation {
	static let createKey = "personas.__new__"
	static let addTitle = "Add Persona"
	static var catalogSubtitle: String { SettingsItem.personasCatalogSubtitle }

	static func pathKey(forPersonaName name: String) -> String {
		"\(SettingsItem.personasSectionKey).\(name)"
	}

	static func isChildKey(_ key: String) -> Bool {
		key.hasPrefix("\(SettingsItem.personasSectionKey).")
	}

	static func isPathKey(_ key: String) -> Bool {
		key == SettingsItem.personasSectionKey || isChildKey(key)
	}

	static func personaName(fromPathKey key: String) -> String? {
		let prefix = "\(SettingsItem.personasSectionKey)."
		guard key.hasPrefix(prefix) else { return nil }
		let name = String(key.dropFirst(prefix.count))
		guard !name.isEmpty, name != "__new__" else { return nil }
		return name
	}

	static func title(for pathKey: String) -> String {
		if pathKey == createKey { return "New Persona" }
		return personaName(fromPathKey: pathKey) ?? "Personas"
	}
}

struct PersonasCatalogRow: View {
	let persona: PersonaOption

	private var imageURL: URL {
		let base = ConfigReader.baseURL().absoluteString
		if let imageUrlString = persona.imageUrl,
			let url = URL(string: base + imageUrlString)
		{
			return url
		}
		return ConfigReader.baseURL()
			.appendingPathComponent("api/personas/image/default.png")
	}

	private var statusText: String? {
		if persona.isDefault == true { return "Default" }
		if persona.isBuiltIn == true { return "Built-in" }
		return nil
	}

	var body: some View {
		HStack(spacing: 10) {
			PersonaImageView(url: imageURL, size: 24)
				.accessibilityHidden(true)
			Text(persona.label)
				.foregroundStyle(.primary)
			Spacer(minLength: 8)
			if let statusText {
				Text(statusText)
					.font(.caption)
					.foregroundStyle(.secondary)
			}
		}
		.accessibilityElement(children: .combine)
		.accessibilityLabel(
			statusText.map { "\(persona.label), \($0)" } ?? persona.label
		)
	}
}
