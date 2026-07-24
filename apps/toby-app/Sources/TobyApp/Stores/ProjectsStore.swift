import Foundation
import Observation

@Observable
@MainActor
final class ProjectsStore {
	var projects: [ProjectSummary] = []
	var selectedProjectId: String?
	var selectedProject: ProjectSummary?
	var projectSessions: [String: [SessionSummary]] = [:]
	var tree: [ProjectTreeEntry] = []
	var personaOptions: [PersonaOption] = []
	var isLoading = false
	var isSaving = false
	var hasLoadedOnce = false
	var lastLoadedAt: Date?
	var errorMessage: String?
	var pendingDelete: PendingDelete?

	struct PendingDelete {
		let projectId: String
		let name: String
	}

	private let client = TobyClient()
	@ObservationIgnored
	nonisolated(unsafe)
	private var autosaveTask: Task<Void, Never>?
	@ObservationIgnored
	nonisolated(unsafe)
	private var folderWatchTask: Task<Void, Never>?
	private var selectedProjectDetailId: String?
	private let autosaveDelay: Duration = .milliseconds(500)

	var selectedProjectName: String {
		selectedProject?.name ?? "Project"
	}

	var selectedProjectSessions: [SessionSummary] {
		guard let selectedProjectId else { return [] }
		return projectSessions[selectedProjectId] ?? []
	}

	deinit {
		autosaveTask?.cancel()
		folderWatchTask?.cancel()
	}

	func load(chatStore: ChatStore? = nil) async {
		guard !isLoading else { return }
		isLoading = true
		errorMessage = nil
		defer { isLoading = false }
		do {
			try await loadListData()
			if let selectedProjectId {
				await selectProject(id: selectedProjectId, chatStore: chatStore)
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func loadList() async {
		guard !isLoading else { return }
		isLoading = true
		errorMessage = nil
		defer { isLoading = false }
		do {
			try await loadListData()
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func ensureLoaded(chatStore: ChatStore? = nil) async {
		if hasLoadedOnce {
			if let selectedProjectId, selectedProjectDetailId != selectedProjectId {
				await selectProject(id: selectedProjectId, chatStore: chatStore)
			}
			return
		}
		await load(chatStore: chatStore)
	}

	func ensureListLoaded() async {
		guard !hasLoadedOnce else { return }
		await loadList()
	}

	func createProject(chatStore: ChatStore) async {
		await flushPendingSave()
		isSaving = true
		errorMessage = nil
		defer { isSaving = false }
		do {
			let created = try await client.createProject()
			projects = try await client.listProjects()
			await refreshProjectSessions()
			await selectProject(id: created.id, chatStore: chatStore)
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func deleteProject(id: String, chatStore: ChatStore? = nil) async {
		await flushPendingSave()
		isSaving = true
		errorMessage = nil
		defer { isSaving = false }
		do {
			try await client.deleteProject(id: id)
			projects = try await client.listProjects()
			await refreshProjectSessions()
			if selectedProjectId == id {
				selectedProjectId = projects.first?.id
				selectedProject = nil
				selectedProjectDetailId = nil
				tree = []
				folderWatchTask?.cancel()
				folderWatchTask = nil
				if let selectedProjectId {
					await selectProject(id: selectedProjectId, chatStore: chatStore)
				} else {
					await chatStore?.startNewSession()
				}
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func selectProject(id: String, chatStore: ChatStore? = nil) async {
		await flushPendingSave()
		selectedProjectId = id
		errorMessage = nil
		do {
			let detail = try await client.fetchProject(id: id)
			selectedProject = detail.project
			selectedProjectDetailId = id
			projectSessions[id] = detail.sessions ?? []
			tree = try await client.fetchProjectTree(id: id)
			startFolderWatch(projectId: id)
			if let chatStore {
				if let session = detail.sessions?.first {
					await chatStore.selectSession(id: session.id)
				} else {
					await chatStore.startNewSession()
				}
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func sessions(for projectId: String) -> [SessionSummary] {
		projectSessions[projectId] ?? []
	}

	func createChat(chatStore: ChatStore) async {
		guard let selectedProjectId else { return }
		await flushPendingSave()
		isSaving = true
		errorMessage = nil
		defer { isSaving = false }
		do {
			let created = try await client.createProjectSession(projectId: selectedProjectId)
			await reloadProjectSessions(projectId: selectedProjectId)
			await chatStore.selectSession(id: created.id)
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func selectChat(id: String, chatStore: ChatStore) async {
		await chatStore.selectSession(id: id)
	}

	func refreshTree() async {
		guard let selectedProjectId else { return }
		do {
			tree = try await client.fetchProjectTree(id: selectedProjectId)
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func updateName(_ name: String) {
		guard var project = selectedProject else { return }
		project = ProjectSummary(
			id: project.id,
			slug: project.slug,
			name: name,
			summary: project.summary,
			folderPath: project.folderPath,
			personaName: project.personaName,
			outputsDir: project.outputsDir,
			skillsDir: project.skillsDir,
			createdAt: project.createdAt,
			updatedAt: project.updatedAt
		)
		selectedProject = project
		scheduleAutosave()
	}

	func updateSummary(_ summary: String) {
		guard var project = selectedProject else { return }
		project = ProjectSummary(
			id: project.id,
			slug: project.slug,
			name: project.name,
			summary: summary,
			folderPath: project.folderPath,
			personaName: project.personaName,
			outputsDir: project.outputsDir,
			skillsDir: project.skillsDir,
			createdAt: project.createdAt,
			updatedAt: project.updatedAt
		)
		selectedProject = project
		scheduleAutosave()
	}

	func updatePersona(_ personaName: String) {
		guard var project = selectedProject else { return }
		let normalized = personaName.isEmpty ? nil : personaName
		project = ProjectSummary(
			id: project.id,
			slug: project.slug,
			name: project.name,
			summary: project.summary,
			folderPath: project.folderPath,
			personaName: normalized,
			outputsDir: project.outputsDir,
			skillsDir: project.skillsDir,
			createdAt: project.createdAt,
			updatedAt: project.updatedAt
		)
		selectedProject = project
		scheduleAutosave()
	}

	func flushPendingSave() async {
		autosaveTask?.cancel()
		autosaveTask = nil
		await save()
	}

	private func scheduleAutosave() {
		autosaveTask?.cancel()
		autosaveTask = Task { [weak self, autosaveDelay] in
			do {
				try await Task.sleep(for: autosaveDelay)
			} catch {
				return
			}
			await self?.save()
		}
	}

	private func save() async {
		guard let project = selectedProject else { return }
		isSaving = true
		defer { isSaving = false }
		do {
			let saved = try await client.updateProject(
				id: project.id,
				name: project.name,
				summary: project.summary,
				personaName: project.personaName ?? ""
			)
			selectedProject = saved
			if let idx = projects.firstIndex(where: { $0.id == saved.id }) {
				projects[idx] = saved
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	private func refreshProjectSessions() async {
		var next: [String: [SessionSummary]] = [:]
		for project in projects {
			do {
				let detail = try await client.fetchProject(id: project.id)
				next[project.id] = detail.sessions ?? []
			} catch {
				next[project.id] = projectSessions[project.id] ?? []
			}
		}
		projectSessions = next
	}

	/// Re-fetch only the persona option list (called when personas change
	/// externally, e.g. via the Persona Editor window).
	func refreshPersonas() async {
		do {
			personaOptions = try await client.listPersonas()
		} catch {
			// Quiet — next full load retries.
		}
	}

	private func loadListData() async throws {
		async let loadedProjects = client.listProjects()
		async let personas = client.listPersonas()
		projects = try await loadedProjects
		personaOptions = try await personas
		await refreshProjectSessions()
		if selectedProjectId == nil || !projects.contains(where: { $0.id == selectedProjectId }) {
			selectedProjectId = projects.first?.id
		}
		if let selectedProjectId {
			if selectedProjectDetailId != selectedProjectId {
				tree = []
			}
			selectedProject = projects.first { $0.id == selectedProjectId }
		} else {
			selectedProject = nil
			tree = []
			selectedProjectDetailId = nil
		}
		hasLoadedOnce = true
		lastLoadedAt = Date()
	}

	private func reloadProjectSessions(projectId: String) async {
		do {
			let detail = try await client.fetchProject(id: projectId)
			projectSessions[projectId] = detail.sessions ?? []
			if selectedProjectId == projectId {
				selectedProject = detail.project
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	private func startFolderWatch(projectId: String) {
		folderWatchTask?.cancel()
		folderWatchTask = Task { [weak self] in
			while !Task.isCancelled {
				try? await Task.sleep(for: .seconds(2))
				await self?.refreshTreeIfStillSelected(projectId: projectId)
			}
		}
	}

	private func refreshTreeIfStillSelected(projectId: String) async {
		guard selectedProjectId == projectId else { return }
		do {
			let nextTree = try await client.fetchProjectTree(id: projectId)
			if nextTree != tree {
				tree = nextTree
			}
		} catch {
			// Folder polling should not replace the user's visible error state.
		}
	}
}
