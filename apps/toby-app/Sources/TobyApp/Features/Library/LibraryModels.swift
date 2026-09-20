import Foundation

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
		embeddingModel: String? = nil
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
	}
}

struct LibraryListResponse: Decodable {
	let items: [LibraryAsset]
	let limit: Int
	let offset: Int
	let total: Int
	let hasMore: Bool
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
