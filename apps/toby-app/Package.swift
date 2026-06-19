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
	dependencies: [
	],
	targets: [
		.executableTarget(
			name: "TobyApp",
			dependencies: [
			],
			path: "Sources/TobyApp",
			exclude: ["Info.plist"],
			linkerSettings: [
				.linkedFramework("EventKit"),
				.linkedFramework("Network"),
				.linkedFramework("ApplicationServices"),
				.linkedFramework("AVFoundation"),
				.linkedFramework("CoreMedia"),
				.linkedFramework("ScreenCaptureKit"),
				.unsafeFlags([
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
	],
)
