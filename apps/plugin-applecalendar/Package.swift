// swift-tools-version: 6.0
import PackageDescription

let package = Package(
	name: "TobyPluginAppleCalendar",
	platforms: [
		.macOS(.v14),
	],
	products: [
		.executable(name: "toby-plugin-applecalendar", targets: ["TobyPluginAppleCalendar"]),
	],
	targets: [
		.target(
			name: "TobyPluginAppleCalendarLib",
			path: "Sources/TobyPluginAppleCalendarLib"
		),
		.executableTarget(
			name: "TobyPluginAppleCalendar",
			dependencies: ["TobyPluginAppleCalendarLib"],
			path: "Sources/TobyPluginAppleCalendar"
		),
		.testTarget(
			name: "TobyPluginAppleCalendarTests",
			dependencies: ["TobyPluginAppleCalendarLib"],
			path: "Tests/TobyPluginAppleCalendarTests"
		),
	]
)
