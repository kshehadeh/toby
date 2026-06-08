// swift-tools-version: 6.0
import PackageDescription

let swiftArch = Context.environment["SWIFT_ARCH"] ?? "arm64"
// Header paths are relative to Sources/WhisperBridge; linker paths to package root.
let whisperInclude = "../../ThirdParty/whisper-\(swiftArch)/include"
let whisperLib = "ThirdParty/whisper-\(swiftArch)/lib"

let whisperLinkerFlags = [
	"-L\(whisperLib)",
	"-lwhisper",
	"-lggml",
	"-lggml-cpu",
	"-lggml-blas",
	"-lggml-metal",
	"-lggml-base",
	"-framework", "Accelerate",
	"-framework", "Metal",
	"-framework", "Foundation",
	"-lc++",
]

let package = Package(
	name: "TobyPluginWhisper",
	platforms: [
		.macOS(.v14),
	],
	products: [
		.executable(name: "toby-plugin-whisper", targets: ["TobyPluginWhisper"]),
	],
	targets: [
		.target(
			name: "WhisperBridge",
			path: "Sources/WhisperBridge",
			publicHeadersPath: "include",
			cxxSettings: [
				.headerSearchPath(whisperInclude),
				.unsafeFlags(["-std=c++17"]),
			],
			linkerSettings: [
				.unsafeFlags(whisperLinkerFlags, .when(platforms: [.macOS])),
			]
		),
		.target(
			name: "TobyPluginWhisperLib",
			dependencies: ["WhisperBridge"],
			path: "Sources/TobyPluginWhisperLib"
		),
		.executableTarget(
			name: "TobyPluginWhisper",
			dependencies: ["TobyPluginWhisperLib"],
			path: "Sources/TobyPluginWhisper"
		),
	]
)
