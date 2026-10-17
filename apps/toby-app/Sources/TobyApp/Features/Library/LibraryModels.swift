import Foundation

enum LibraryOriginFilter: String, CaseIterable, Identifiable {
	case all
	case chat
	case project
	case manual

	var id: String { rawValue }

	var label: String {
		switch self {
		case .all: "All files"
		case .chat: "Chats"
		case .project: "Projects"
		case .manual: "Library"
		}
	}

	var queryValue: String? {
		self == .all ? nil : rawValue
	}
}

struct LibraryReference: Decodable, Equatable, Identifiable {
	let id: String
	let kind: String
	let label: String
	let detail: String?
	let sessionId: String?
	let projectId: String?
	let createdAt: String

	var placeTitle: String {
		switch kind {
		case "chat": "Chat"
		case "project": "Project"
		case "manual": "Library"
		default: kind.capitalized
		}
	}

	var placeDetail: String {
		switch kind {
		case "chat":
			let name = label.trimmingCharacters(in: .whitespacesAndNewlines)
			return name.isEmpty ? "Chat" : name
		case "project":
			let name = label.trimmingCharacters(in: .whitespacesAndNewlines)
			if let detail, !detail.isEmpty {
				return name.isEmpty ? detail : "\(name) · \(detail)"
			}
			return name.isEmpty ? "Project" : name
		default:
			return "Added in the library"
		}
	}
}

struct LibraryAsset: Decodable, Identifiable, Equatable {
	let id: String
	let title: String
	let originalFilename: String
	let relativePath: String
	let mimeType: String
	let byteSize: Int
	let contentHash: String
	let description: String
	let status: String
	let error: String?
	let source: String
	let createdAt: String
	let updatedAt: String
	let embeddingModel: String?
	let references: [LibraryReference]?

	var places: [LibraryReference] { references ?? [] }

	var isPending: Bool { status == "pending" }
	var isFailed: Bool { status == "failed" }
	var isReady: Bool { status == "ready" }

	var absolutePath: String {
		URL(fileURLWithPath: ConfigReader.libraryDir(), isDirectory: true)
			.appendingPathComponent(relativePath)
			.path
	}

	var systemImage: String {
		if mimeType.hasPrefix("image/") { return "photo" }
		if mimeType == "application/pdf" { return "doc.richtext" }
		if mimeType.contains("markdown") { return "doc.text" }
		return "doc"
	}

	var byteSizeLabel: String {
		ByteCountFormatter.string(fromByteCount: Int64(byteSize), countStyle: .file)
	}

	var originSummary: String {
		let refs = places
		if refs.isEmpty {
			switch source {
			case "chat": return "Chat"
			case "project": return "Project"
			default: return "Library"
			}
		}
		var parts: [String] = []
		if refs.contains(where: { $0.kind == "chat" }) { parts.append("Chat") }
		if refs.contains(where: { $0.kind == "project" }) { parts.append("Project") }
		if refs.contains(where: { $0.kind == "manual" }) { parts.append("Library") }
		return parts.joined(separator: " · ")
	}

	var listSubtitle: String {
		let body = description.isEmpty ? originalFilename : description
		let origin = originSummary
		if origin.isEmpty { return body }
		return "\(origin) · \(body)"
	}

	init(
		id: String,
		title: String,
		originalFilename: String,
		relativePath: String,
		mimeType: String,
		byteSize: Int,
		contentHash: String,
		description: String,
		status: String,
		error: String? = nil,
		source: String = "ui",
		createdAt: String,
		updatedAt: String,
		embeddingModel: String? = nil,
		references: [LibraryReference]? = nil
	) {
		self.id = id
		self.title = title
		self.originalFilename = originalFilename
		self.relativePath = relativePath
		self.mimeType = mimeType
		self.byteSize = byteSize
		self.contentHash = contentHash
		self.description = description
		self.status = status
		self.error = error
		self.source = source
		self.createdAt = createdAt
		self.updatedAt = updatedAt
		self.embeddingModel = embeddingModel
		self.references = references
	}
}

struct LibraryListResponse: Decodable {
	let items: [LibraryAsset]
	let limit: Int
	let offset: Int
	let total: Int
	let hasMore: Bool
	let catalogSyncing: Bool?
}

struct LibraryDetailResponse: Decodable {
	let item: LibraryAsset
}

struct LibraryCreateResponse: Decodable {
	let item: LibraryAsset
	let duplicate: Bool?
}

struct LibraryCreateRequest: Encodable {
	let filename: String
	let mediaType: String
	let dataBase64: String
}

struct LibraryPatchRequest: Encodable {
	var title: String?
	var description: String?
	var filename: String?
	var mediaType: String?
	var dataBase64: String?
}
