// swift-tools-version: 6.0
import PackageDescription

let package = Package(
	name: "TobyPluginWebSearch",
	platforms: [
		.macOS(.v14),
	],
	products: [
		.executable(name: "toby-plugin-websearch", targets: ["TobyPluginWebSearch"]),
	],
	targets: [
		.target(
			name: "TobyPluginWebSearchLib",
			path: "Sources/TobyPluginWebSearchLib"
		),
		.executableTarget(
			name: "TobyPluginWebSearch",
			dependencies: ["TobyPluginWebSearchLib"],
			path: "Sources/TobyPluginWebSearch"
		),
	]
)
