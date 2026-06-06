// swift-tools-version: 6.0
import PackageDescription

let package = Package(
	name: "TobyAudioHelper",
	platforms: [
		.macOS(.v14),
	],
	products: [
		.executable(name: "toby-audio-helper", targets: ["TobyAudioHelper"]),
	],
	targets: [
		.executableTarget(
			name: "TobyAudioHelper",
			path: "Sources/TobyAudioHelper",
			exclude: ["Info.plist"],
			linkerSettings: [
				.linkedFramework("AVFoundation"),
				.linkedFramework("ScreenCaptureKit"),
				.linkedFramework("Speech"),
				.unsafeFlags([
					"-Xlinker",
					"-sectcreate",
					"-Xlinker",
					"__TEXT",
					"-Xlinker",
					"__info_plist",
					"-Xlinker",
					"Sources/TobyAudioHelper/Info.plist",
				]),
			],
		),
	],
)
