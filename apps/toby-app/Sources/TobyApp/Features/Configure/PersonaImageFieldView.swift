import SwiftUI
import UniformTypeIdentifiers

// MARK: - Persona Image Field

struct PersonaImageFieldView: View {
	@Bindable var store: ConfigureStore
	let field: SettingsItem

	@State private var isPickerPresented = false
	@State private var showResetConfirm = false

	private var personaName: String? {
		let key = field.key
		guard key.hasPrefix("personas.") && key.hasSuffix(".imagePath") else {
			return nil
		}
		let middle = String(key.dropFirst("personas.".count).dropLast(".imagePath".count))
		return middle.isEmpty ? nil : middle
	}

	private var imageFilename: String {
		let value = field.currentValue ?? store.value(for: field.key)
		return value.isEmpty ? "default.png" : value
	}

	private var imageURL: URL {
		ConfigReader.baseURL()
			.appendingPathComponent("api/personas/image/\(imageFilename)")
	}

	var body: some View {
		HStack(spacing: 16) {
			PersonaImageView(url: imageURL, size: 56)

			VStack(alignment: .leading, spacing: 8) {
				Text(field.currentValue?.isEmpty ?? true ? "Default image" : "Custom image")
					.font(.subheadline)
					.foregroundStyle(SettingsDesign.rowDescription)

				HStack(spacing: 10) {
					SettingsActionButton(title: "Choose Image…", showsExternalIcon: false) {
						isPickerPresented = true
					}
					.disabled(store.isSaving || personaName == nil)

					if field.currentValue?.isEmpty == false {
						SettingsActionButton(title: "Reset to Default", showsExternalIcon: false) {
							showResetConfirm = true
						}
						.disabled(store.isSaving)
					}
				}
			}

			Spacer(minLength: 0)
		}
		.fileImporter(
			isPresented: $isPickerPresented,
			allowedContentTypes: [.png, .jpeg, .image],
			allowsMultipleSelection: false,
		) { result in
			handleFilePickerResult(result)
		}
		.alert("Reset Image?", isPresented: $showResetConfirm) {
			Button("Cancel", role: .cancel) {}
			Button("Reset", role: .destructive) {
				if let personaName {
					Task { await store.resetPersonaImage(personaName: personaName) }
				}
			}
		} message: {
			Text("This will remove the custom image and use the default persona image.")
		}
	}

	private func handleFilePickerResult(_ result: Result<[URL], Error>) {
		switch result {
		case .success(let urls):
			guard let url = urls.first, let personaName else { return }
			Task {
				do {
					let accessed = url.startAccessingSecurityScopedResource()
					defer {
						if accessed { url.stopAccessingSecurityScopedResource() }
					}
					let data = try Data(contentsOf: url)
					await store.uploadPersonaImage(
						personaName: personaName,
						fileData: data,
						filename: url.lastPathComponent,
					)
				} catch {
					store.errorMessage = error.localizedDescription
				}
			}
		case .failure(let error):
			store.errorMessage = error.localizedDescription
		}
	}
}
