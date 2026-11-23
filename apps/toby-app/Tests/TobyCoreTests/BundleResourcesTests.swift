import Foundation
import Testing
@testable import TobyCore

@Suite("Bundle resources")
struct BundleResourcesTests {
	@Test func resolvesBundledResources() {
		let bundle = Bundle.tobyCoreResources
		#expect(bundle.url(forResource: "toby", withExtension: "png", subdirectory: "Resources/personas") != nil)
		#expect(bundle.url(forResource: "apple-tools", withExtension: "json", subdirectory: "Resources") != nil)
		#expect(bundle.url(forResource: "mail-tools", withExtension: "json", subdirectory: "Resources") != nil)
		#expect(!PersonaService.resource("toby-instructions").isEmpty)
	}

	/// Packaged apps keep module bundles in `Contents/Resources/`, which the
	/// native-build-system `Bundle.module` accessor never checks; release builds
	/// trap on first use. Production code must go through the wrappers.
	@Test func productionSourcesAvoidBareBundleModule() throws {
		let sources = URL(fileURLWithPath: #filePath)
			.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
			.appending(path: "Sources")
		let allowed: Set<String> = ["BundleResources.swift"]
		var offenders: [String] = []
		let files = FileManager.default.enumerator(at: sources, includingPropertiesForKeys: nil)
		while let file = files?.nextObject() as? URL {
			guard file.pathExtension == "swift", !allowed.contains(file.lastPathComponent) else { continue }
			let text = try String(contentsOf: file, encoding: .utf8)
			if text.contains("Bundle.module") { offenders.append(file.path) }
		}
		#expect(offenders.isEmpty, "Use Bundle.tobyCoreResources / Bundle.tobyResources: \(offenders)")
	}
}
