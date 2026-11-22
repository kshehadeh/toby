// swift-tools-version: 6.2
import PackageDescription

let package = Package(
	name: "TobyApp",
	platforms: [
		.macOS(.v26),
	],
	products: [
		.executable(name: "toby-app", targets: ["TobyApp"]),
		.library(name: "TobyAI", targets: ["TobyAI"]),
		.library(name: "TobyStore", targets: ["TobyStore"]),
		.library(name: "TobyCore", targets: ["TobyCore"]),
	],
	dependencies: [
		.package(url: "https://github.com/sparkle-project/Sparkle", from: "2.9.3"),
		.package(url: "https://github.com/nalexn/ViewInspector", from: "0.10.0"),
		.package(url: "https://github.com/mchakravarty/CodeEditorView", exact: "0.16.0"),
		.package(url: "https://github.com/groue/GRDB.swift", from: "7.10.0"),
	],
	targets: [
		.target(
			name: "TobyAI",
			path: "Sources/TobyAI",
			linkerSettings: [
				.linkedFramework("Network"),
				.linkedFramework("Security"),
				.linkedFramework("Accelerate"),
			],
		),
		.target(
			name: "TobyStore",
			dependencies: [
				"TobyAI",
				.product(name: "GRDB", package: "GRDB.swift"),
			],
			path: "Sources/TobyStore",
		),
		.target(
			name: "TobyCore",
			dependencies: [
				"TobyAI",
				"TobyStore",
				.product(name: "GRDB", package: "GRDB.swift"),
			],
			path: "Sources/TobyCore",
			resources: [
				.copy("Resources"),
			],
			linkerSettings: [
				.linkedFramework("PDFKit"),
			],
		),
		.executableTarget(
			name: "TobyApp",
			dependencies: [
				"TobyAI",
				"TobyStore",
				"TobyCore",
				.product(name: "Sparkle", package: "Sparkle"),
				.product(name: "CodeEditorView", package: "CodeEditorView"),
				.product(name: "LanguageSupport", package: "CodeEditorView"),
			],
			path: "Sources/TobyApp",
			exclude: ["Info.plist"],
			resources: [
				.copy("Resources"),
			],
			linkerSettings: [
				.linkedFramework("EventKit"),
				.linkedFramework("Contacts"),
				.linkedFramework("Network"),
				.linkedFramework("ApplicationServices"),
				.linkedFramework("AVFoundation"),
				.linkedFramework("CoreMedia"),
				.linkedFramework("ScreenCaptureKit"),
				.linkedFramework("CoreWLAN"),
				.linkedFramework("IOBluetooth"),
				.linkedFramework("CoreAudio"),
				.linkedFramework("CoreGraphics"),
				.linkedFramework("UserNotifications"),
				.linkedFramework("CoreLocation"),
				.linkedFramework("MapKit"),
				.linkedFramework("ServiceManagement"),
				.linkedFramework("TipKit"),
				.unsafeFlags([
					"-Xlinker",
					"-rpath",
					"-Xlinker",
					"@executable_path/../Frameworks",
					"-Xlinker",
					"-sectcreate",
					"-Xlinker",
					"__TEXT",
					"-Xlinker",
					"__info_plist",
					"-Xlinker",
					"Sources/TobyApp/Info.plist",
				]),
			],
		),
		.testTarget(
			name: "TobyAppTests",
			dependencies: [
				"TobyApp",
				"TobyCore",
				"TobyStore",
				.product(name: "ViewInspector", package: "ViewInspector"),
				.product(name: "LanguageSupport", package: "CodeEditorView"),
			],
			path: "Tests/TobyAppTests",
		),
		.testTarget(
			name: "TobyAITests",
			dependencies: ["TobyAI"],
			path: "Tests/TobyAITests",
		),
		.testTarget(
			name: "TobyStoreTests",
			dependencies: [
				"TobyStore",
				"TobyAI",
				.product(name: "GRDB", package: "GRDB.swift"),
			],
			path: "Tests/TobyStoreTests",
		),
		.testTarget(
			name: "TobyCoreTests",
			dependencies: [
				"TobyCore",
				"TobyStore",
				"TobyAI",
				.product(name: "GRDB", package: "GRDB.swift"),
			],
			path: "Tests/TobyCoreTests",
			exclude: ["Fixtures"],
		),
	],
)
