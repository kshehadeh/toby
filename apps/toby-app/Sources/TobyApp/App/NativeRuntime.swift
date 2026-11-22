import Foundation
import TobyAI
import TobyCore
import TobyStore

/// Migration switch between the TypeScript daemon and the native Swift core.
///
/// Off by default while the native services are being built. Turn it on
/// against a *copied* Toby home (`TOBY_DIR=/tmp/toby-copy TOBY_NATIVE=1`) to
/// exercise the native path; the M7 cutover enables it for everyone.
enum NativeMode {
	static let defaultsKey = "toby.native.enabled"

	static var isEnabled: Bool {
		if let env = ProcessInfo.processInfo.environment["TOBY_NATIVE"] {
			return env == "1" || env.lowercased() == "true"
		}
		return UserDefaults.standard.bool(forKey: defaultsKey)
	}
}

/// Owns the Swift-side store and AI client for native mode.
@MainActor
final class NativeRuntime {
	static let shared = NativeRuntime()

	private(set) var paths = TobyPaths.current()
	private var database: TobyDatabase?
	private(set) var lastImport: LegacyImporter.Report?

	/// The OpenRouter client, keyed from the Keychain.
	let ai = OpenRouterClient(keyProvider: KeychainKeyStore())

	private var todoRouter: NativeTodoRouter?
	private var todoSyncLoop: Task<Void, Never>?

	/// The in-process `/api/todos` implementation. Starts the todo sync loop.
	func todos() throws -> NativeTodoRouter {
		let database = try store()
		if let todoRouter, todoRouter.service.isBacked(by: database) { return todoRouter }
		let service = TodoService(writer: database.writer, tobyDirectory: paths.root)
		let sync = NativeTodoSyncService(service: service, tobyDirectory: paths.root)
		let router = NativeTodoRouter(actions: TodoActions(service: service), sync: sync)
		todoRouter = router
		todoSyncLoop?.cancel()
		todoSyncLoop = Task.detached(priority: .utility) { await sync.runLoop() }
		return router
	}

	private var memoryRouter: NativeMemoryRouter?

	/// In-process memories + graph. Embeddings use OpenRouter when signed in.
	func memories() throws -> NativeMemoryRouter {
		let database = try store()
		if let memoryRouter, memoryRouter.memory.isBacked(by: database) { return memoryRouter }
		let embedder = ai.embeddingModel()
		let keychain = KeychainKeyStore()
		let router = NativeMemoryRouter(
			memory: MemoryService(writer: database.writer) {
				((try? keychain.read()) ?? nil)?.isEmpty == false ? embedder : nil
			},
			graph: GraphService(writer: database.writer),
		)
		memoryRouter = router
		return router
	}

	private var libraryRouter: NativeLibraryRouter?

	/// In-process library. Summaries use the fast model; embeddings OpenRouter.
	func library() throws -> NativeLibraryRouter {
		let database = try store()
		if let libraryRouter, libraryRouter.library.isBacked(by: database.writer) { return libraryRouter }
		let client = ai
		let keychain = KeychainKeyStore()
		let signedIn: @Sendable () -> Bool = { ((try? keychain.read()) ?? nil)?.isEmpty == false }
		let router = NativeLibraryRouter(
			library: LibraryService(
				writer: database.writer,
				libraryDirectory: paths.library,
				summarizer: { signedIn() ? AILibrarySummarizer(model: client.model(ModelDefaults.fast)) : nil },
				embedder: { signedIn() ? client.embeddingModel() : nil },
			),
			projects: ProjectService(writer: database.writer, tobyDirectory: paths.root),
		)
		libraryRouter = router
		return router
	}

	private var chatRouter: NativeChatRouter?
	private var chatStoreIdentity: ObjectIdentifier?

	/// The native chat engine (one per Toby home; holds active turns).
	func chat() throws -> NativeChatRouter {
		let database = try store()
		let identity = ObjectIdentifier(database)
		if let chatRouter, chatStoreIdentity == identity { return chatRouter }
		let memories = try memories()
		let library = try library()
		let todos = try todos()
		let projects = ProjectService(writer: database.writer, tobyDirectory: paths.root)
		let personas = PersonaService(tobyDirectory: paths.root)
		let toolbox = ChatToolbox(
			todos: todos.actions, memory: memories.memory, graph: memories.graph, library: library.library,
			projects: projects, skills: SkillService(root: paths.skills), tobyDirectory: paths.root, ai: ai,
			apple: AppleTools(bridge: AppNativeBridge()),
		)
		let engine = ChatEngine(
			sessions: projects.sessions, toolbox: toolbox, personas: personas, ai: ai,
			chatModelOverride: { UserDefaults.standard.string(forKey: "toby.ai.chatModel") },
			location: {
				let data = await NativeLocationHandler.shared.currentLocation(body: nil)
				let value = try JSONDecoder().decode(JSONValue.self, from: data)
				return value["data"] ?? value
			},
		)
		let router = NativeChatRouter(engine: engine, sessions: projects.sessions, personas: personas, projects: projects)
		chatRouter = router
		chatStoreIdentity = identity
		return router
	}

	/// In-process personas, skills, and projects.
	func files() throws -> NativeFilesRouter {
		let database = try store()
		return NativeFilesRouter(
			personas: PersonaService(tobyDirectory: paths.root),
			skills: SkillService(root: paths.skills),
			projects: ProjectService(writer: database.writer, tobyDirectory: paths.root),
		)
	}

	/// Open the native database, importing the legacy home on first use.
	func store() throws -> TobyDatabase {
		let current = TobyPaths.current()
		if let database, current == paths { return database }
		paths = current
		let opened = try TobyDatabase.open(paths: current)
		let importer = LegacyImporter(paths: current, database: opened)
		if try !importer.hasImported() {
			lastImport = try importer.run()
		}
		database = opened
		return opened
	}
}
