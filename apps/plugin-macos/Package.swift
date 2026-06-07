// swift-tools-version: 6.0
import PackageDescription

let package = Package(
	name: "TobyPluginMacOS",
	platforms: [
		.macOS(.v14),
	],
	products: [
		.executable(name: "toby-plugin-macos", targets: ["TobyPluginMacOS"]),
	],
	targets: [
		.target(
			name: "TobyPluginMacOSLib",
			path: "Sources/TobyPluginMacOSLib",
			exclude: ["Info.plist"],
			resources: [
				.process("BundledShortcuts"),
			],
			linkerSettings: [
				.linkedFramework("CoreWLAN"),
				.linkedFramework("CoreAudio"),
				.linkedFramework("IOBluetooth"),
				.linkedFramework("IOKit"),
				.linkedFramework("AppKit"),
				.unsafeFlags([
					"-Xlinker",
					"-sectcreate",
					"-Xlinker",
					"__TEXT",
					"-Xlinker",
					"__info_plist",
					"-Xlinker",
					"Sources/TobyPluginMacOSLib/Info.plist",
				]),
			]
		),
		.executableTarget(
			name: "TobyPluginMacOS",
			dependencies: ["TobyPluginMacOSLib"],
			path: "Sources/TobyPluginMacOS"
		),
	]
)
