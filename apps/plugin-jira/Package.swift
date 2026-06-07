// swift-tools-version: 6.0
import PackageDescription

let package = Package(
	name: "TobyPluginJira",
	platforms: [
		.macOS(.v14),
	],
	products: [
		.executable(name: "toby-plugin-jira", targets: ["TobyPluginJira"]),
	],
	targets: [
		.target(
			name: "TobyPluginJiraLib",
			path: "Sources/TobyPluginJiraLib"
		),
		.executableTarget(
			name: "TobyPluginJira",
			dependencies: ["TobyPluginJiraLib"],
			path: "Sources/TobyPluginJira"
		),
		.testTarget(
			name: "TobyPluginJiraTests",
			dependencies: ["TobyPluginJiraLib"],
			path: "Tests/TobyPluginJiraTests"
		),
	]
)
