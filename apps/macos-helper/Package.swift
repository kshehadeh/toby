// swift-tools-version: 6.0
import PackageDescription

let package = Package(
	name: "TobyMacOSHelper",
	platforms: [
		.macOS(.v14),
	],
	products: [
		.executable(name: "toby-macos-helper", targets: ["TobyMacOSHelper"]),
	],
	targets: [
		.executableTarget(
			name: "TobyMacOSHelper",
			path: "Sources/TobyMacOSHelper",
			exclude: ["Info.plist"],
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
					"Sources/TobyMacOSHelper/Info.plist",
				]),
			]
		),
	]
)
