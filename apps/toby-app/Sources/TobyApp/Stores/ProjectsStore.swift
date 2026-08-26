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
	/// When true, the project route shows the selected project's chat workspace
	/// instead of the project details page.
	var isShowingChat = false

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
		selectedProject?.name ?? "Projects"
	}

	var selectedProjectSessions: [SessionSummary] {
		guard let selectedProjectId else { return [] }
		return projectSessions[selectedProjectId] ?? []
	}

	func recentSessions(limit: Int = 5) -> [SessionSummary] {
		Array(selectedProjectSessions.prefix(limit))
	}

	func metaLine(for project: ProjectSummary) -> String {
		projectMetaLine(
			chatCount: sessions(for: project.id).count,
			personaName: project.personaName,
			options: personaOptions,
		)
	}

	deinit {
		autosaveTask?.cancel()
		folderWatchTask?.cancel()
	}

	/// Clears projects state after a Toby home directory switch.
	func resetForHomeSwitch() {
		autosaveTask?.cancel()
		autosaveTask = nil
		folderWatchTask?.cancel()
		folderWatchTask = nil
		projects = []
		selectedProjectId = nil
		selectedProject = nil
		projectSessions = [:]
		tree = []
		personaOptions = []
		isLoading = false
		isSaving = false
		hasLoadedOnce = false
		lastLoadedAt = nil
		errorMessage = nil
		pendingDelete = nil
		selectedProjectDetailId = nil
		isShowingChat = false
	}

	func load() async {
		guard !isLoading else { return }
		isLoading = true
		errorMessage = nil
		defer { isLoading = false }
		do {
			try await loadListData()
			if let selectedProjectId {
				await selectProject(id: selectedProjectId)
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

	func ensureLoaded() async {
		if hasLoadedOnce {
			if let selectedProjectId, selectedProjectDetailId != selectedProjectId {
				await selectProject(id: selectedProjectId)
			}
			return
		}
		await load()
	}

	func ensureListLoaded() async {
		guard !hasLoadedOnce else { return }
		await loadList()
	}

	func createProject() async {
		await flushPendingSave()
		isSaving = true
		errorMessage = nil
		defer { isSaving = false }
		do {
			let created = try await client.createProject()
			projects = try await client.listProjects()
			await refreshProjectSessions()
			await selectProject(id: created.id)
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
				await selectHome(flush: false)
				await chatStore?.startNewSession()
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	/// Leaves a project chat and shows the selected project's details page.
	func showProjectHome() {
		isShowingChat = false
	}

	func selectHome(flush: Bool = true) async {
		if flush {
			await flushPendingSave()
		}
		folderWatchTask?.cancel()
		folderWatchTask = nil
		selectedProjectId = nil
		selectedProject = nil
		selectedProjectDetailId = nil
		isShowingChat = false
		tree = []
	}

	func selectProject(id: String) async {
		await flushPendingSave()
		let alreadyLoaded = selectedProjectId == id && selectedProjectDetailId == id
		selectedProjectId = id
		isShowingChat = false
		if alreadyLoaded {
			return
		}
		errorMessage = nil
		if selectedProject?.id != id {
			selectedProject = projects.first { $0.id == id }
		}
		do {
			let detail = try await client.fetchProject(id: id)
			selectedProject = detail.project
			selectedProjectDetailId = id
			projectSessions[id] = detail.sessions ?? []
			tree = try await client.fetchProjectTree(id: id)
			startFolderWatch(projectId: id)
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
			isShowingChat = true
			await chatStore.selectSession(id: created.id)
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func selectChat(id: String, chatStore: ChatStore) async {
		isShowingChat = true
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
		if let selectedProjectId, projects.contains(where: { $0.id == selectedProjectId }) {
			if selectedProjectDetailId != selectedProjectId {
				tree = []
			}
			selectedProject = projects.first { $0.id == selectedProjectId }
		} else {
			selectedProjectId = nil
			selectedProject = nil
			tree = []
			selectedProjectDetailId = nil
			isShowingChat = false
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
		// Poll less aggressively — a 2s tree refresh was invalidating the project
		// inspector during chat scroll and contributing to main-thread freezes.
		folderWatchTask = Task { [weak self] in
			while !Task.isCancelled {
				try? await Task.sleep(for: .seconds(8))
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
