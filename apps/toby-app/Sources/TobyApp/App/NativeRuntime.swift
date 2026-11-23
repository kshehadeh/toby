import AppKit
import Foundation
import GRDB
import TobyAI
import TobyCore
import TobyStore

/// Owns the Swift-side store, AI client, and background services.
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
	private var chatToolbox: ChatToolbox?
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
			apple: AppleTools(bridge: AppNativeBridge()), mail: try mail(), slack: slack,
		)
		chatToolbox = toolbox
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
		startSlackInbound(engine: engine, sessions: projects.sessions, writer: database.writer)
		return router
	}

	private var mailService: MailService?
	private var mailSyncLoop: Task<Void, Never>?

	/// Built-in IMAP/SMTP mail. Account secrets live in the Keychain (`mail.*`).
	func mail() throws -> MailService {
		let database = try store()
		if let mailService, mailService.isBacked(by: database.writer) { return mailService }
		let service = MailService(writer: database.writer, secrets: KeychainSecretStore())
		mailService = service
		mailSyncLoop?.cancel()
		mailSyncLoop = Task.detached(priority: .utility) { await service.runSyncLoop() }
		return service
	}

	let slack = SlackService(api: SlackAPI(secrets: KeychainSecretStore()))
	private var slackInbound: Task<Void, Never>?

	/// Slack replies (Socket Mode) when `chatInbound` is enabled for Slack.
	/// The running Slack replies service (nil when chat replies are off).
	private(set) var slackInboundService: SlackInbound?

	private var inboundInputs: (engine: ChatEngine, sessions: ChatSessionStore, writer: any DatabaseWriter)?

	/// Re-read `chatInbound` and restart (or stop) Slack replies.
	func reloadChatReplies() {
		if let inputs = inboundInputs {
			startSlackInbound(engine: inputs.engine, sessions: inputs.sessions, writer: inputs.writer)
		} else {
			_ = try? chat()
		}
	}

	private func startSlackInbound(engine: ChatEngine, sessions: ChatSessionStore, writer: any DatabaseWriter) {
		inboundInputs = (engine, sessions, writer)
		slackInbound?.cancel()
		slackInbound = nil
		slackInboundService = nil
		let config = (try? Data(contentsOf: paths.legacyConfig)).flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) }?["chatInbound"]
		guard config?["enabled"] == true, (config?["integration"]?.stringValue ?? "slack") == "slack" else { return }
		let persona = config?["persona"]?.stringValue
		let inbound = SlackInbound(slack: slack, engine: engine, sessions: sessions, writer: writer, personaName: { persona })
		slackInboundService = inbound
		slackInbound = Task.detached(priority: .utility) { await inbound.run() }
	}

	private var followupsRouter: NativeFollowupsRouter?
	private var followupsStoreIdentity: ObjectIdentifier?
	private var followupsScheduler: Task<Void, Never>?

	/// Follow-ups over the observation ledger (mail, Slack, calendar, chats,
	/// todos, memory). Evaluation and extraction use the structured model.
	func followups() throws -> NativeFollowupsRouter {
		let database = try store()
		let identity = ObjectIdentifier(database)
		if let followupsRouter, followupsStoreIdentity == identity { return followupsRouter }
		let todos = try todos().actions.service
		let configURL = paths.legacyConfig
		let keychain = KeychainKeyStore()
		let signedIn: @Sendable () -> Bool = { ((try? keychain.read()) ?? nil)?.isEmpty == false }
		let model = ai.model(ModelDefaults.structured)
		let embedder = ai.embeddingModel()
		let projects = ProjectService(writer: database.writer, tobyDirectory: paths.root)
		let apple = AppleTools(bridge: AppNativeBridge())
		let service = FollowupService(
			writer: database.writer, todos: todos,
			sources: [
				MailObservationSource(mail: try mail()), SlackObservationSource(slack: slack), CalendarObservationSource(apple: apple, writer: database.writer),
				MemoryObservationSource(writer: database.writer), ChatObservationSource(sessions: projects.sessions, writer: database.writer), TodoObservationSource(todos: todos),
			],
			config: { FollowupConfig(((try? Data(contentsOf: configURL)).flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) })?["followups"]) },
			embedder: { signedIn() ? embedder : nil },
			evaluate: FollowupService.modelEvaluator(model), extract: GraphEnrichment.modelExtractor(model),
			notify: NativeFollowupsRouter.notifyCompleted, ready: signedIn,
		)
		let router = NativeFollowupsRouter(followups: service, configURL: configURL)
		followupsRouter = router
		followupsStoreIdentity = identity
		followupsScheduler?.cancel()
		followupsScheduler = Task.detached(priority: .utility) { await service.runScheduler() }
		return router
	}

	private var flowsRouter: NativeFlowsRouter?
	private var flowsStoreIdentity: ObjectIdentifier?
	private var flowsSupervisor: Task<Void, Never>?

	/// Flows: definitions, runs, and the trigger supervisor (schedules, macOS events).
	func flows() throws -> NativeFlowsRouter {
		let database = try store()
		let identity = ObjectIdentifier(database)
		if let flowsRouter, flowsStoreIdentity == identity { return flowsRouter }
		_ = try chat()
		guard let toolbox = chatToolbox else { throw TobyClientError.serverError("Flows need the chat toolbox.") }
		let runner = FlowRunner(writer: database.writer, tools: FlowTools(toolbox: toolbox), personas: PersonaService(tobyDirectory: paths.root),
		                        skills: SkillService(root: paths.skills), ai: ai, mail: try mail(), slack: slack)
		let service = FlowService(writer: database.writer, runner: runner, events: AppFlowEventSource(), ai: ai)
		let router = NativeFlowsRouter(flows: service)
		flowsRouter = router
		flowsStoreIdentity = identity
		flowsSupervisor?.cancel()
		flowsSupervisor = Task.detached(priority: .utility) { await service.runSupervisor() }
		return router
	}

	/// Recordings: transcripts (Apple on-device), summaries, titles.
	func listen() throws -> NativeListenRouter {
		NativeListenRouter(listen: ListenService(recordings: paths.listenRecordings, configURL: paths.legacyConfig,
		                                         personas: PersonaService(tobyDirectory: paths.root), ai: ai, bridge: AppNativeBridge()))
	}

	private var feedRouter: NativeFeedRouter?
	private var feedStoreIdentity: ObjectIdentifier?
	private var feedScheduler: Task<Void, Never>?

	/// The native Feed (calendar, reminders, todos). Starts the 15-minute scheduler.
	func feed() throws -> NativeFeedRouter {
		let database = try store()
		let identity = ObjectIdentifier(database)
		if let feedRouter, feedStoreIdentity == identity { return feedRouter }
		let apple = AppleTools(bridge: AppNativeBridge())
		let service = try FeedService(
			sources: [MailFeedSource(mail: try mail()), CalendarFeedSource(apple: apple), RemindersFeedSource(apple: apple), SlackFeedSource(slack: slack)],
			todos: try todos().actions.service, memory: try memories().memory,
			personas: PersonaService(tobyDirectory: paths.root), ai: ai, tobyDirectory: paths.root,
		)
		let router = NativeFeedRouter(feed: service)
		feedRouter = router
		feedStoreIdentity = identity
		feedScheduler?.cancel()
		feedScheduler = Task.detached(priority: .utility) { await service.runScheduler(notify: NativeFeedRouter.notify) }
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

	/// App launch: open (importing the legacy home on first run), retire the
	/// old daemon once, and start the background services.
	func launch() {
		do {
			let database = try store()
			let imported = (try? LegacyImporter(paths: paths, database: database).hasImported()) ?? false
			LegacyDaemonCleanup.runOnce(paths, imported: imported)
		} catch {
			TobyLog.shared.error("app", "store_open_failed", ["error": .string(error.localizedDescription)])
		}
		// Load the Keychain vault once (migrating older items without prompts).
		_ = TobyKeychain.shared.value("openrouter.apiKey")
		let skipped = TobyKeychain.shared.skippedLegacyKeys
		if !skipped.isEmpty {
			TobyLog.shared.warn("keychain", "legacy_secrets_need_reconnect", ["keys": .array(skipped.map(JSONValue.string))])
		}
		startBackgroundServices()
	}

	/// Start the loops the daemon used to run: todo sync, mail sync, the Feed
	/// scheduler, and Slack replies. Idempotent per Toby home.
	func startBackgroundServices() {
		_ = try? todos()
		_ = try? mail()
		_ = try? feed()
		_ = try? chat()
		_ = try? followups()
		_ = try? flows()
		_ = try? backups()
	}

	private var backupService: BackupService?
	private var snapshotLoop: Task<Void, Never>?

	/// Backup files and the daily data snapshots in the sync vault.
	func backups() throws -> BackupService {
		let database = try store()
		if let backupService, backupService.paths == paths { return backupService }
		let service = BackupService(paths: paths, writer: database.writer, secrets: KeychainSecretStore(), openRouter: KeychainKeyStore())
		backupService = service
		snapshotLoop?.cancel()
		snapshotLoop = Task.detached(priority: .background) { await service.runSnapshotLoop() }
		return service
	}

	/// The sync vault shared by todo sync and data snapshots.
	func vault() -> SyncVault {
		SyncVault(tobyDirectory: paths.root, passphrase: .keychain(tobyDirectory: paths.root))
	}

	/// Relaunch so a staged restore is applied before the database reopens.
	func relaunchToApplyRestore() {
		Task { @MainActor in
			try? await Task.sleep(for: .seconds(1))
			let process = Process()
			process.executableURL = URL(fileURLWithPath: "/bin/sh")
			process.arguments = ["-c", "sleep 1; open \"\(Bundle.main.bundleURL.path)\""]
			try? process.run()
			NSApp.terminate(nil)
		}
	}

	/// Open the native database, importing the legacy home on first use.
	func store() throws -> TobyDatabase {
		let current = TobyPaths.current()
		if let database, current == paths { return database }
		paths = current
		TobyLog.shared.configure(tobyDirectory: current.root)
		// A staged restore swaps in before anything opens the database.
		var restoredProjects: [String] = []
		if BackupService.hasPending(current) {
			restoredProjects = try BackupService.applyPending(current, secrets: KeychainSecretStore(), openRouter: KeychainKeyStore())
		}
		let opened = try TobyDatabase.open(paths: current)
		let importer = LegacyImporter(paths: current, database: opened)
		if try !importer.hasImported() {
			lastImport = try importer.run()
		}
		try BackupService.repointProjects(restoredProjects, writer: opened.writer, projectsDir: current.projects)
		database = opened
		return opened
	}
}
