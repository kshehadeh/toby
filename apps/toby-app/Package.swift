// swift-tools-version: 6.0
import PackageDescription

let package = Package(
	name: "TobyApp",
	platforms: [
		.macOS(.v14),
	],
	products: [
		.executable(name: "toby-app", targets: ["TobyApp"]),
	],
	targets: [
		.executableTarget(
			name: "TobyApp",
			path: "Sources/TobyApp",
		),
	],
)
