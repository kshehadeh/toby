// swift-tools-version: 6.2
import PackageDescription

let package = Package(
	name: "TobyApp",
	platforms: [
		.macOS(.v26),
	],
	products: [
		.executable(name: "toby-app", targets: ["TobyApp"]),
	],
	dependencies: [
		.package(url: "https://github.com/sparkle-project/Sparkle", from: "2.9.3"),
		.package(url: "https://github.com/nalexn/ViewInspector", from: "0.10.0"),
	],
	targets: [
		.executableTarget(
			name: "TobyApp",
			dependencies: [
				.product(name: "Sparkle", package: "Sparkle"),
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
				.product(name: "ViewInspector", package: "ViewInspector"),
			],
			path: "Tests/TobyAppTests",
		),
	],
)
