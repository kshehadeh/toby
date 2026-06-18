import Foundation

enum AppToastStyle {
	case success
	case error
}

struct AppToastState: Identifiable {
	let id = UUID()
	let style: AppToastStyle
	let title: String
	let message: String?
}

struct AppStatus: Decodable {
	let version: String
	let persona: String
	let model: String
	let connectedIntegrations: [String]?
	let skillCount: Int?
}

struct PersonaOption: Decodable, Identifiable {
	var id: String { name }
	let name: String
	let label: String
}

struct SessionSummary: Decodable, Identifiable {
	let id: String
	let name: String
	let createdAt: String?
	let updatedAt: String?
}

struct SessionDetail: Decodable {
	let id: String
	let name: String
	let transcript: [TranscriptEntry]
	let messageCount: Int
	let settings: SessionSettings?
	let activePlan: PlanSummary?
}

struct SessionSettings: Decodable {
	let persona: String?
	let modules: [String]?
	let dryRun: Bool?
	let debug: Bool?
}

struct PlanSummary: Decodable {
	let id: String
	let goal: String
	let status: String
	let phases: [PlanPhaseSummary]
}

struct PlanPhaseSummary: Decodable {
	let id: String
	let label: String
	let status: String
}

struct CreateSessionResponse: Decodable {
	let id: String
	let name: String
	let settings: SessionSettings?
}

struct ListenSourceSelection: Decodable {
	let mic: Bool
	let system: Bool
}

struct ListenSessionInfo: Decodable {
	let id: String
	let startedAt: String
	let sources: ListenSourceSelection
}

struct ListenStatusResponse: Decodable {
	let status: String
	let session: ListenSessionInfo?
	let outputDir: String?
	let message: String?
	let error: String?

	var isActive: Bool {
		status == "starting" || status == "recording" || status == "stopping"
			|| (status == "error" && session != nil)
	}
}

struct ListenStopResponse: Decodable {
	let status: String
	let session: ListenSessionInfo?
	let outputDir: String?
	let message: String?
	let error: String?
	let transcript: String?
	let transcriptionError: String?

	var asStatus: ListenStatusResponse {
		ListenStatusResponse(
			status: status,
			session: session,
			outputDir: outputDir,
			message: message,
			error: error,
		)
	}
}

struct NativeAudioStopResponse: Decodable {
	let status: String
	let message: String?
	let id: String?
	let outputDir: String?
	let files: [String: String]?
	let errors: [String]?

	var asStatus: ListenStatusResponse {
		ListenStatusResponse(
			status: status,
			session: nil,
			outputDir: outputDir,
			message: message,
			error: nil,
		)
	}
}

struct ListenRecordingSummary: Decodable, Identifiable {
	let id: String
	let dir: String
	let name: String?
	let description: String?
	let createdAt: String
	let startedAt: String
	let stoppedAt: String?
	let durationMs: Int?
	let sources: ListenSourceSelection
	let hasAudio: Bool
	let hasTranscript: Bool

	var displayName: String {
		if let name, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
			return name
		}
		return startedAt
	}
}

struct ListenRecordingsListResponse: Decodable {
	let recordings: [ListenRecordingSummary]
}

struct ListenRecordingMetadata: Decodable {
	let id: String
	let name: String?
	let description: String?
	let createdAt: String
	let startedAt: String
	let stoppedAt: String?
	let durationMs: Int?
	let sources: ListenSourceSelection
	let errors: [String]?
}

struct ListenRecordingDetail: Decodable {
	let id: String
	let dir: String
	let metadata: ListenRecordingMetadata
	let hasAudio: Bool
	let audioPath: String?
	let hasTranscript: Bool
	let transcript: String?
	let transcriptError: String?
	let warnings: [String]?
}

enum TranscriptEntry: Decodable, Identifiable, Equatable {
	case user(text: String)
	case assistant(text: String)
	case meta(text: String)
	case notice(text: String, tone: String?)
	case error(text: String)
	case boxedStep(BoxedStepPayload)
	case toolCall(blockKey: String, title: String)
	case toolOutput(blockKey: String, detail: String)
	case askUserQA(blockKey: String, query: String, answer: String, error: String?)
	case turnWork(durationMs: Int)

	var id: String {
		switch self {
		case .user(let text):
			return "user-\(text.hashValue)"
		case .assistant(let text):
			return "assistant-\(text.hashValue)"
		case .meta(let text):
			return "meta-\(text.hashValue)"
		case .notice(let text, _):
			return "notice-\(text.hashValue)"
		case .error(let text):
			return "error-\(text.hashValue)"
		case .boxedStep(let payload):
			return "boxed-\(payload.id)-\(payload.seq)"
		case .toolCall(let blockKey, _):
			return "tool-call-\(blockKey)"
		case .toolOutput(let blockKey, _):
			return "tool-output-\(blockKey)"
		case .askUserQA(let blockKey, _, _, _):
			return "ask-user-\(blockKey)"
		case .turnWork(let durationMs):
			return "turn-work-\(durationMs)"
		}
	}

	private enum CodingKeys: String, CodingKey {
		case kind
		case text
		case tone
		case id
		case seq
		case variant
		case header
		case body
		case toolBlockKey
		case toolName
		case integrationLabel
		case cacheHit
		case blockKey
		case title
		case detail
		case query
		case answer
		case error
		case durationMs
	}

	init(from decoder: Decoder) throws {
		let container = try decoder.container(keyedBy: CodingKeys.self)
		let kind = try container.decode(String.self, forKey: .kind)

		switch kind {
		case "user":
			self = .user(text: try container.decode(String.self, forKey: .text))
		case "assistant":
			self = .assistant(text: try container.decode(String.self, forKey: .text))
		case "meta":
			self = .meta(text: try container.decode(String.self, forKey: .text))
		case "notice":
			self = .notice(
				text: try container.decode(String.self, forKey: .text),
				tone: try container.decodeIfPresent(String.self, forKey: .tone),
			)
		case "error":
			self = .error(text: try container.decode(String.self, forKey: .text))
		case "boxed_step":
			self = .boxedStep(
				BoxedStepPayload(
					id: try container.decode(String.self, forKey: .id),
					seq: try container.decode(Int.self, forKey: .seq),
					variant: try container.decode(String.self, forKey: .variant),
					header: try container.decode(String.self, forKey: .header),
					body: try container.decode(String.self, forKey: .body),
					toolName: try container.decodeIfPresent(String.self, forKey: .toolName),
					integrationLabel: try container.decodeIfPresent(String.self, forKey: .integrationLabel),
					cacheHit: try container.decodeIfPresent(Bool.self, forKey: .cacheHit),
				),
			)
		case "tool_call":
			self = .toolCall(
				blockKey: try container.decode(String.self, forKey: .blockKey),
				title: try container.decode(String.self, forKey: .title),
			)
		case "tool_output":
			self = .toolOutput(
				blockKey: try container.decode(String.self, forKey: .blockKey),
				detail: try container.decode(String.self, forKey: .detail),
			)
		case "ask_user_qa":
			self = .askUserQA(
				blockKey: try container.decode(String.self, forKey: .blockKey),
				query: try container.decode(String.self, forKey: .query),
				answer: try container.decode(String.self, forKey: .answer),
				error: try container.decodeIfPresent(String.self, forKey: .error),
			)
		case "turn_work":
			self = .turnWork(durationMs: try container.decode(Int.self, forKey: .durationMs))
		default:
			self = .meta(text: kind)
		}
	}
}

struct BoxedStepPayload: Equatable {
	let id: String
	let seq: Int
	let variant: String
	let header: String
	let body: String
	let toolName: String?
	let integrationLabel: String?
	let cacheHit: Bool?
}

struct ChatEventPayload: Decodable {
	let type: String
	let delta: String?
	let header: String?
	let id: String?
	let blockKey: String?
	let detail: String?
	let line: String?
	let toolName: String?
	let integrationLabel: String?
	let cacheHit: Bool?
	let text: String?
	let tone: String?
	let interim: Bool?
}

struct CreateIssueResponse: Decodable {
	let ok: Bool
	let url: String?
	let number: Int?
	let fallbackUrl: String?
	let reason: String?
}

struct TurnDonePayload: Decodable {
	let turnId: String?
	let text: String
	let appliedActions: [String]?
	let sessionName: String?
}

struct AskUserPromptPayload: Decodable {
	let turnId: String
	let requestId: String
	let query: String
	let options: [String]
}

struct StreamingAssistantState: Equatable {
	var header: String
	var text: String
	/// When true, stream inside the active "Worked for" group instead of the main transcript line.
	var inWorkArea: Bool
}
