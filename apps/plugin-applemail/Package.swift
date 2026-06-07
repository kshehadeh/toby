// swift-tools-version: 6.0
import PackageDescription

let package = Package(
	name: "TobyPluginAppleMail",
	platforms: [
		.macOS(.v14),
	],
	products: [
		.executable(name: "toby-plugin-applemail", targets: ["TobyPluginAppleMail"]),
	],
	targets: [
		.target(
			name: "TobyPluginAppleMailLib",
			path: "Sources/TobyPluginAppleMailLib"
		),
		.executableTarget(
			name: "TobyPluginAppleMail",
			dependencies: ["TobyPluginAppleMailLib"],
			path: "Sources/TobyPluginAppleMail"
		),
		.testTarget(
			name: "TobyPluginAppleMailTests",
			dependencies: ["TobyPluginAppleMailLib"],
			path: "Tests/TobyPluginAppleMailTests"
		),
	]
)
