import Darwin
import Foundation
import ObjectiveC

// MARK: - ObjC messaging helper (Swift 6 compatible)

private enum ObjCMsg {
	/// Resolve objc_msgSend via dlsym to avoid the Swift 6 "unavailable variadic" error.
	nonisolated(unsafe) private static let rtldDefault = UnsafeMutableRawPointer(bitPattern: -2)
	nonisolated(unsafe) private static let msgSendPtr = dlsym(rtldDefault, "objc_msgSend")

	/// Call an ObjC method with 3 object arguments.
	static func send3(_ obj: AnyObject, _ sel: Selector, _ a1: AnyObject, _ a2: AnyObject, _ a3: AnyObject) {
		typealias Fn = @convention(c) (AnyObject, Selector, AnyObject, AnyObject, AnyObject) -> Void
		guard let ptr = msgSendPtr else { return }
		let fn = unsafeBitCast(ptr, to: Fn.self)
		fn(obj, sel, a1, a2, a3)
	}

	/// Call an ObjC method with 2 object arguments.
	static func send2(_ obj: AnyObject, _ sel: Selector, _ a1: AnyObject, _ a2: AnyObject) {
		typealias Fn = @convention(c) (AnyObject, Selector, AnyObject, AnyObject) -> Void
		guard let ptr = msgSendPtr else { return }
		let fn = unsafeBitCast(ptr, to: Fn.self)
		fn(obj, sel, a1, a2)
	}

	/// Call an ObjC method with 1 object argument.
	static func send1(_ obj: AnyObject, _ sel: Selector, _ a1: AnyObject) {
		typealias Fn = @convention(c) (AnyObject, Selector, AnyObject) -> Void
		guard let ptr = msgSendPtr else { return }
		let fn = unsafeBitCast(ptr, to: Fn.self)
		fn(obj, sel, a1)
	}
}

// MARK: - Focus commands

enum FocusCommands {
	// MARK: - Paths

	private static var dndDBDir: String {
		FileManager.default.homeDirectoryForCurrentUser
			.appendingPathComponent("Library/DoNotDisturb/DB").path
	}

	private static var modeConfigPath: String { dndDBDir + "/ModeConfigurations.json" }
	private static var assertionsPath: String { dndDBDir + "/Assertions.json" }

	// MARK: - Private framework

	@discardableResult
	private static func loadDNDFramework() -> Bool {
		let path = "/System/Library/PrivateFrameworks/DoNotDisturb.framework"
		guard let bundle = Bundle(path: path) else { return false }
		return bundle.load()
	}

	/// Get DNDModeAssertionService shared instance, trying "sharedInstance" then "shared".
	private static func getAssertionService() throws -> AnyObject {
		guard loadDNDFramework() else {
			throw HelperError.runtime(
				"Could not load DoNotDisturb.framework. Try using Shortcuts instead: configure 'shortcutFocusOn' in Toby Configure."
			)
		}
		guard let serviceClass = NSClassFromString("DNDModeAssertionService") else {
			throw HelperError.runtime(
				"DNDModeAssertionService class not found. Your macOS version may use a different API. Try Shortcuts instead."
			)
		}

		let sharedInstanceSel = NSSelectorFromString("sharedInstance")
		let sharedSel = NSSelectorFromString("shared")
		let sel: Selector
		if serviceClass.responds(to: sharedInstanceSel) {
			sel = sharedInstanceSel
		} else if serviceClass.responds(to: sharedSel) {
			sel = sharedSel
		} else {
			throw HelperError.runtime(
				"DNDModeAssertionService has no shared instance accessor. Try Shortcuts instead."
			)
		}

		guard
			let serviceObj = (serviceClass as AnyObject).perform(sel)?.takeUnretainedValue()
		else {
			throw HelperError.runtime("Could not get DNDModeAssertionService instance.")
		}
		return serviceObj
	}

	/// Try reading Focus status via the private DNDStateService API.
	/// Returns nil if the API is unavailable or the call fails.
	private static func statusViaFramework() -> (active: Bool, modeIdentifier: String?, modeName: String?)? {
		guard loadDNDFramework() else { return nil }
		guard let stateClass = NSClassFromString("DNDStateService") else { return nil }

		let sharedInstanceSel = NSSelectorFromString("sharedInstance")
		let sharedSel = NSSelectorFromString("shared")
		let sel: Selector
		if stateClass.responds(to: sharedInstanceSel) {
			sel = sharedInstanceSel
		} else if stateClass.responds(to: sharedSel) {
			sel = sharedSel
		} else {
			return nil
		}

		guard let stateObj = (stateClass as AnyObject).perform(sel)?.takeUnretainedValue() else {
			return nil
		}

		// Try to read "modeIdentifier" from the state object
		let modeIdSel = NSSelectorFromString("modeIdentifier")
		if (stateObj as AnyObject).responds(to: modeIdSel),
			let modeId = (stateObj as AnyObject).perform(modeIdSel)?.takeUnretainedValue() as? String,
			!modeId.isEmpty
		{
			let modeName = resolveModeName(identifier: modeId)
			return (active: true, modeIdentifier: modeId, modeName: modeName ?? modeId)
		}

		// Try reading "isFocusEnabled" as a boolean check
		let enabledSel = NSSelectorFromString("isFocusEnabled")
		if (stateObj as AnyObject).responds(to: enabledSel),
			let enabled = (stateObj as AnyObject).perform(enabledSel)?.takeUnretainedValue() as? Bool
		{
			return (active: enabled, modeIdentifier: nil, modeName: nil)
		}

		return nil
	}

	// MARK: - Access helpers

	/// Detect FDA-restricted access: file exists but contents returns nil.
	private static func isAccessDenied(path: String) -> Bool {
		let fm = FileManager.default
		return fm.fileExists(atPath: path) && fm.contents(atPath: path) == nil
	}

	// MARK: - Status

	static func status() throws {
		// Prefer private framework for status (works even when file access is restricted)
		if let result = statusViaFramework() {
			JSONOutput.success([
				"active": result.active,
				"modeIdentifier": result.modeIdentifier as Any,
				"modeName": result.modeName as Any,
			])
			return
		}

		// Fallback: read from file system
		let fm = FileManager.default

		guard fm.fileExists(atPath: assertionsPath) else {
			JSONOutput.success(["active": false])
			return
		}

		if isAccessDenied(path: assertionsPath) {
			JSONOutput.success([
				"active": false,
				"statusUnavailable": true,
				"statusUnavailableReason":
					"Focus status requires either DoNotDisturb.framework support or Full Disk Access for ~/Library/DoNotDisturb/DB/. Native focus set/off may still work with a known mode identifier.",
			])
			return
		}

		guard let data = fm.contents(atPath: assertionsPath) else {
			throw HelperError.runtime("Could not read Assertions.json")
		}

		guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
			throw HelperError.runtime("Could not parse Assertions.json")
		}

		let assertions = json["data"] as? [[String: Any]] ?? []
		var activeModeId: String?

		for assertion in assertions {
			if let details = assertion["assertionDetails"] as? [String: Any] {
				activeModeId = details["assertionDetailsModeIdentifier"] as? String
				if activeModeId != nil { break }
			}
		}

		if let modeId = activeModeId {
			let modeName = resolveModeName(identifier: modeId)
			JSONOutput.success([
				"active": true,
				"modeIdentifier": modeId,
				"modeName": modeName ?? modeId,
			])
		} else {
			JSONOutput.success(["active": false])
		}
	}

	// MARK: - List

	static func list() throws {
		let fm = FileManager.default

		guard fm.fileExists(atPath: modeConfigPath) else {
			throw HelperError.runtime(
				"ModeConfigurations.json not found at \(modeConfigPath). Focus modes may not be configured."
			)
		}

		if isAccessDenied(path: modeConfigPath) {
			throw HelperError.permission(
				"Listing Focus modes requires Full Disk Access for ~/Library/DoNotDisturb/DB/. Native focus set/off can still work without Full Disk Access when you provide a known mode identifier."
			)
		}

		guard let data = fm.contents(atPath: modeConfigPath) else {
			throw HelperError.runtime("Could not read ModeConfigurations.json")
		}

		guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
			throw HelperError.runtime("Could not parse ModeConfigurations.json")
		}

		let configurations = json["data"] as? [[String: Any]] ?? []
		var modes: [[String: String]] = []

		for config in configurations {
			let modeId =
				config["modeIdentifier"] as? String
				?? config["identifier"] as? String ?? ""
			let name =
				config["modeName"] as? String
				?? config["name"] as? String ?? modeId
			let semanticType = config["semanticType"] as? String ?? ""
			modes.append([
				"identifier": modeId,
				"name": name,
				"semanticType": semanticType,
			])
		}

		JSONOutput.success(["modes": modes, "count": modes.count])
	}

	// MARK: - Set

	static func set(_ parser: inout ArgParser) throws {
		guard let modeId = parser.parseValue("--mode") else {
			throw HelperError.usage(
				"--mode <identifier> is required. Use 'focus list' to see available modes."
			)
		}

		let serviceObj = try getAssertionService()

		let addSel = NSSelectorFromString(
			"addModeAssertionWithIdentifier:forReason:withHandler:"
		)
		guard (serviceObj as AnyObject).responds(to: addSel) else {
			throw HelperError.runtime(
				"addModeAssertionWithIdentifier:forReason:withHandler: not available on this macOS version. Try Shortcuts instead."
			)
		}

		var success = false
		var errorMsg: String?
		let semaphore = DispatchSemaphore(value: 0)

		let handler: @convention(block) (Any?, Error?) -> Void = { _, error in
			if let error = error {
				errorMsg = error.localizedDescription
			} else {
				success = true
			}
			semaphore.signal()
		}

		ObjCMsg.send3(
			serviceObj,
			addSel,
			modeId as AnyObject,
			"Toby CLI" as AnyObject,
			unsafeBitCast(handler, to: AnyObject.self)
		)

		let waitResult = semaphore.wait(timeout: .now() + 10)
		if waitResult == .timedOut { success = true }

		if !success, let msg = errorMsg {
			throw HelperError.runtime(
				"Failed to activate focus mode: \(msg). Try using Shortcuts instead."
			)
		}

		let modeName = resolveModeName(identifier: modeId)
		JSONOutput.success([
			"active": true,
			"modeIdentifier": modeId,
			"modeName": modeName ?? modeId,
		])
	}

	// MARK: - Off

	static func off() throws {
		let serviceObj = try getAssertionService()

		// Try clearAllModeAssertionsWithHandler: first
		let clearSel = NSSelectorFromString("clearAllModeAssertionsWithHandler:")
		if (serviceObj as AnyObject).responds(to: clearSel) {
			var success = false
			var errorMsg: String?
			let semaphore = DispatchSemaphore(value: 0)

			let handler: @convention(block) (Error?) -> Void = { error in
				if let error = error {
					errorMsg = error.localizedDescription
				} else {
					success = true
				}
				semaphore.signal()
			}

			ObjCMsg.send1(
				serviceObj,
				clearSel,
				unsafeBitCast(handler, to: AnyObject.self)
			)

			let waitResult = semaphore.wait(timeout: .now() + 10)
			if waitResult == .timedOut { success = true }

			if !success, let msg = errorMsg {
				throw HelperError.runtime("Failed to clear focus modes: \(msg)")
			}
		} else {
			// Fallback: remove each active assertion individually
			let removeSel = NSSelectorFromString(
				"removeModeAssertionForIdentifier:withHandler:"
			)
			guard (serviceObj as AnyObject).responds(to: removeSel) else {
				throw HelperError.runtime(
					"No method available to clear focus modes. Try using Shortcuts instead."
				)
			}

			let fm = FileManager.default
			if let data = fm.contents(atPath: assertionsPath),
				let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
				let assertions = json["data"] as? [[String: Any]]
			{
				for assertion in assertions {
					if let details = assertion["assertionDetails"] as? [String: Any],
						let modeId = details["assertionDetailsModeIdentifier"] as? String
					{
						let handler: @convention(block) (Error?) -> Void = { _ in }
						ObjCMsg.send2(
							serviceObj,
							removeSel,
							modeId as AnyObject,
							unsafeBitCast(handler, to: AnyObject.self)
						)
					}
				}
			}
			Thread.sleep(forTimeInterval: 0.3)
		}

		JSONOutput.success(["active": false])
	}

	// MARK: - Helpers

	private static func resolveModeName(identifier: String) -> String? {
		let fm = FileManager.default
		guard
			let data = fm.contents(atPath: modeConfigPath),
			let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
			let configurations = json["data"] as? [[String: Any]]
		else { return nil }

		for config in configurations {
			let modeId =
				config["modeIdentifier"] as? String
				?? config["identifier"] as? String ?? ""
			if modeId == identifier {
				return config["modeName"] as? String ?? config["name"] as? String
			}
		}
		return nil
	}
}
