import AppKit
import ApplicationServices
import CoreAudio
import CoreGraphics
import CoreWLAN
import Foundation
import IOKit
import IOKit.ps
import IOBluetooth
import UserNotifications

@_silgen_name("IOBluetoothPreferenceSetControllerPowerState")
func IOBluetoothPreferenceSetControllerPowerState(_ state: UInt32)
@_silgen_name("IOBluetoothPreferenceGetControllerPowerState")
func IOBluetoothPreferenceGetControllerPowerState() -> UInt32

@_silgen_name("IODisplayGetFloatParameter")
func IODisplayGetFloatParameterFunc(_ service: io_object_t, _ options: UInt32, _ paramName: CFString, _ value: UnsafeMutablePointer<Float32>) -> kern_return_t

private final class NativeNotificationDelegate: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
	func userNotificationCenter(
		_ center: UNUserNotificationCenter,
		willPresent notification: UNNotification,
		withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
	) {
		completionHandler([.banner, .list, .sound])
	}

	func userNotificationCenter(
		_ center: UNUserNotificationCenter,
		didReceive response: UNNotificationResponse,
		withCompletionHandler completionHandler: @escaping () -> Void
	) {
		let userInfo = response.notification.request.content.userInfo
		if let type = userInfo["type"] as? String,
			type == "scheduleCompletion",
			let scheduleId = userInfo["scheduleId"] as? String
		{
			DispatchQueue.main.async {
				NotificationCenter.default.post(
					name: .openScheduleFromNotification,
					object: OpenScheduleFromNotificationRequest(scheduleId: scheduleId)
				)
			}
		}
		completionHandler()
	}
}

enum NativeMacOSHandler {
	private static let notificationDelegate = NativeNotificationDelegate()

	// MARK: - Accessibility status

	static func accessibilityStatus() -> Data {
		let trusted = AXIsProcessTrusted()
		return json(["ok": true, "data": ["accessibilityGranted": trusted]])
	}

	// MARK: - Wi-Fi

	static func wifiStatus() -> Data {
		let client = CWWiFiClient.shared()
		guard let interface = client.interface() else {
			return json(["ok": false, "error": "No Wi-Fi interface found"])
		}
		var data: [String: Any] = [:]
		data["interface"] = interface.interfaceName ?? "unknown"
		data["powerOn"] = interface.powerOn()
		if interface.powerOn() {
			data["ssid"] = interface.ssid()
			data["bssid"] = interface.bssid()
			data["rssi"] = interface.rssiValue()
			if let channel = interface.wlanChannel() {
				data["channel"] = channel.channelNumber
				data["channelBand"] = channel.channelBand.rawValue
			}
			data["security"] = interface.security().rawValue
		}
		return json(["ok": true, "data": data])
	}

	static func wifiScan() -> Data {
		let client = CWWiFiClient.shared()
		guard let interface = client.interface() else {
			return json(["ok": false, "error": "No Wi-Fi interface found"])
		}
		guard interface.powerOn() else {
			return json(["ok": false, "error": "Wi-Fi is off. Turn it on before scanning."])
		}
		let networks: Set<CWNetwork>
		do {
			networks = try interface.scanForNetworks(withSSID: nil)
		} catch {
			return json(["ok": false, "error": "Wi-Fi scan failed: \(error.localizedDescription)"])
		}
		var items: [[String: Any]] = []
		for net in networks {
			var item: [String: Any] = [:]
			item["ssid"] = net.ssid ?? ""
			item["bssid"] = net.bssid ?? ""
			item["rssi"] = net.rssiValue
			if let channel = net.wlanChannel {
				item["channel"] = channel.channelNumber
				item["channelBand"] = channel.channelBand.rawValue
			}
			items.append(item)
		}
		let data: [String: Any] = [
			"interface": interface.interfaceName ?? "unknown",
			"networks": items,
			"count": items.count,
		]
		return json(["ok": true, "data": data])
	}

	static func wifiSetPower(body: Data?) -> Data {
		guard let enabled = boolValue(body, key: "enabled") else {
			return json(["ok": false, "error": "enabled is required."])
		}
		let client = CWWiFiClient.shared()
		guard let interface = client.interface() else {
			return json(["ok": false, "error": "No Wi-Fi interface found"])
		}
		do {
			try interface.setPower(enabled)
			let data: [String: Any] = [
				"interface": interface.interfaceName ?? "unknown",
				"enabled": enabled,
			]
			return json(["ok": true, "data": data])
		} catch {
			return json(["ok": false, "error": "Failed to \(enabled ? "enable" : "disable") Wi-Fi: \(error.localizedDescription)"])
		}
	}

	// MARK: - Battery

	static func batteryStatus() -> Data {
		let snapshot = IOPSCopyPowerSourcesInfo().takeRetainedValue()
		let sources = IOPSCopyPowerSourcesList(snapshot).takeRetainedValue() as [CFTypeRef]
		var batteryInfo: [String: Any] = [:]
		for source in sources {
			let description = IOPSGetPowerSourceDescription(snapshot, source)
			guard let descUnmanaged = description else { continue }
			let info = descUnmanaged.takeUnretainedValue() as! [String: Any]
			guard let type = info[kIOPSTypeKey as String] as? String, type == kIOPSInternalBatteryType as String else { continue }
			batteryInfo["sourceType"] = type
			batteryInfo["name"] = info[kIOPSNameKey as String] ?? "InternalBattery"
			if let charge = info[kIOPSCurrentCapacityKey as String] as? Int { batteryInfo["chargePercent"] = charge }
			if let maxCap = info[kIOPSMaxCapacityKey as String] as? Int { batteryInfo["maxCapacity"] = maxCap }
			if let isCharging = info[kIOPSIsChargingKey as String] as? Bool { batteryInfo["isCharging"] = isCharging }
			if let state = info[kIOPSPowerSourceStateKey as String] as? String { batteryInfo["powerSourceState"] = state }
			if let timeRemaining = info[kIOPSTimeToEmptyKey as String] as? Int { batteryInfo["timeToEmptyMinutes"] = timeRemaining }
			if let timeToFull = info[kIOPSTimeToFullChargeKey as String] as? Int { batteryInfo["timeToFullChargeMinutes"] = timeToFull }
			if let isPresent = info[kIOPSIsPresentKey as String] as? Bool { batteryInfo["isPresent"] = isPresent }
			if let cycleCount = readCycleCount() { batteryInfo["cycleCount"] = cycleCount }
			break
		}
		if batteryInfo.isEmpty {
			return json(["ok": false, "error": "No internal battery found (desktop Mac?)"])
		}
		return json(["ok": true, "data": batteryInfo])
	}

	private static func readCycleCount() -> Int? {
		let service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("AppleSmartBattery"))
		defer { IOObjectRelease(service) }
		guard service != 0 else { return nil }
		var properties: Unmanaged<CFMutableDictionary>?
		let kr = IORegistryEntryCreateCFProperties(service, &properties, kCFAllocatorDefault, 0)
		guard kr == KERN_SUCCESS, let props = properties?.takeRetainedValue() as? [String: Any] else { return nil }
		return props["CycleCount"] as? Int
	}

	// MARK: - Audio devices

	private static let kDeviceUID: AudioObjectPropertySelector = 0x75696420

	private static func audioAddr(selector: AudioObjectPropertySelector, scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
		AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
	}

	private static func audioStringProperty(id: AudioObjectID, selector: AudioObjectPropertySelector) -> String? {
		var address = audioAddr(selector: selector)
		var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
		var value: Unmanaged<CFString>?
		guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, &value) == noErr, let value else { return nil }
		return value.takeRetainedValue() as String
	}

	static func audioListOutputs() -> Data {
		var address = audioAddr(selector: kAudioHardwarePropertyDevices)
		var size: UInt32 = 0
		var status = AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size)
		guard status == noErr else { return json(["ok": false, "error": "Could not get audio device list size: \(status)"]) }
		let count = Int(size) / MemoryLayout<AudioObjectID>.size
		var ids = [AudioObjectID](repeating: 0, count: count)
		status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &ids)
		guard status == noErr else { return json(["ok": false, "error": "Could not get audio device list: \(status)"]) }

		var defaultOutputID: AudioObjectID = 0
		var defaultInputID: AudioObjectID = 0
		var defaultSize = UInt32(MemoryLayout<AudioObjectID>.size)
		var outAddr = audioAddr(selector: kAudioHardwarePropertyDefaultOutputDevice)
		AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &outAddr, 0, nil, &defaultSize, &defaultOutputID)
		var inAddr = audioAddr(selector: kAudioHardwarePropertyDefaultInputDevice)
		AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &inAddr, 0, nil, &defaultSize, &defaultInputID)

		var outputs: [[String: Any]] = []
		var inputs: [[String: Any]] = []
		for id in ids {
			guard let info = audioDeviceInfo(id: id, defaultOutputID: defaultOutputID, defaultInputID: defaultInputID) else { continue }
			if info["isOutput"] as? Bool == true { outputs.append(info) }
			if info["isInput"] as? Bool == true { inputs.append(info) }
		}
		let data: [String: Any] = [
			"outputs": outputs,
			"inputs": inputs,
			"defaultOutputId": Int(defaultOutputID),
			"defaultInputId": Int(defaultInputID),
		]
		return json(["ok": true, "data": data])
	}

	private static func audioDeviceInfo(id: AudioObjectID, defaultOutputID: AudioObjectID, defaultInputID: AudioObjectID) -> [String: Any]? {
		guard let name = audioStringProperty(id: id, selector: kAudioDevicePropertyDeviceNameCFString) else { return nil }
		let uid = audioStringProperty(id: id, selector: kDeviceUID) ?? ""

		let isOutput = audioHasStreams(id: id, scope: kAudioObjectPropertyScopeOutput)
		let isInput = audioHasStreams(id: id, scope: kAudioObjectPropertyScopeInput)

		var info: [String: Any] = [
			"id": Int(id),
			"name": name,
			"uid": uid,
			"isOutput": isOutput,
			"isInput": isInput,
			"isDefaultOutput": id == defaultOutputID,
			"isDefaultInput": id == defaultInputID,
		]
		var sampleRate: Float64 = 0
		var srSize = UInt32(MemoryLayout<Float64>.size)
		var srAddr = audioAddr(selector: kAudioDevicePropertyNominalSampleRate)
		if AudioObjectGetPropertyData(id, &srAddr, 0, nil, &srSize, &sampleRate) == noErr {
			info["sampleRate"] = sampleRate
		}
		return info
	}

	private static func audioHasStreams(id: AudioObjectID, scope: AudioObjectPropertyScope) -> Bool {
		var addr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreamConfiguration, mScope: scope, mElement: kAudioObjectPropertyElementMain)
		var size: UInt32 = 0
		guard AudioObjectGetPropertyDataSize(id, &addr, 0, nil, &size) == noErr else { return false }
		guard let buffer = malloc(Int(size)) else { return false }
		defer { free(buffer) }
		guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, buffer) == noErr else { return false }
		let list = buffer.assumingMemoryBound(to: AudioBufferList.self)
		return list.pointee.mNumberBuffers > 0
	}

	static func audioSwitchOutput(body: Data?) -> Data {
		guard let nameOrUid = stringValue(body, key: "deviceSubstring"), !nameOrUid.isEmpty else {
			return json(["ok": false, "error": "deviceSubstring is required."])
		}
		var address = audioAddr(selector: kAudioHardwarePropertyDevices)
		var size: UInt32 = 0
		var status = AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size)
		guard status == noErr else { return json(["ok": false, "error": "Could not get audio device list: \(status)"]) }
		let count = Int(size) / MemoryLayout<AudioObjectID>.size
		var ids = [AudioObjectID](repeating: 0, count: count)
		status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &ids)
		guard status == noErr else { return json(["ok": false, "error": "Could not get audio device list: \(status)"]) }

		var matchedID: AudioObjectID?
		for id in ids {
			guard id != 0 else { continue }
			if let uid = audioStringProperty(id: id, selector: kDeviceUID),
				(uid == nameOrUid || uid.contains(nameOrUid))
			{
				matchedID = id
				break
			}
			if let name = audioStringProperty(id: id, selector: kAudioDevicePropertyDeviceNameCFString),
				(name == nameOrUid || name.localizedCaseInsensitiveContains(nameOrUid))
			{
				matchedID = id
				break
			}
		}
		guard let targetID = matchedID else {
			return json(["ok": false, "error": "No audio device found matching \"\(nameOrUid)\""])
		}
		var newDefault = targetID
		var setAddr = audioAddr(selector: kAudioHardwarePropertyDefaultOutputDevice)
		let setSize = UInt32(MemoryLayout<AudioObjectID>.size)
		status = AudioObjectSetPropertyData(AudioObjectID(kAudioObjectSystemObject), &setAddr, 0, nil, setSize, &newDefault)
		guard status == noErr else { return json(["ok": false, "error": "Failed to set default output device: \(status)"]) }
		let name = audioStringProperty(id: targetID, selector: kAudioDevicePropertyDeviceNameCFString) ?? "unknown"
		let data: [String: Any] = ["deviceId": Int(targetID), "name": name]
		return json(["ok": true, "data": data])
	}

	static func audioVolume() -> Data {
		var deviceID: AudioObjectID = 0
		var size = UInt32(MemoryLayout<AudioObjectID>.size)
		var addr = audioAddr(selector: kAudioHardwarePropertyDefaultOutputDevice)
		guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &deviceID) == noErr, deviceID != 0 else {
			return json(["ok": false, "error": "No default output device"])
		}
		let scope = kAudioObjectPropertyScopeOutput
		var volume: Float32 = 0
		var volAddr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyVolumeScalar, mScope: scope, mElement: kAudioObjectPropertyElementMain)
		var volSize = UInt32(MemoryLayout<Float32>.size)
		let hasVolume = AudioObjectGetPropertyData(deviceID, &volAddr, 0, nil, &volSize, &volume) == noErr
		var muted: UInt32 = 0
		var muteAddr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyMute, mScope: scope, mElement: kAudioObjectPropertyElementMain)
		var muteSize = UInt32(MemoryLayout<UInt32>.size)
		let hasMute = AudioObjectGetPropertyData(deviceID, &muteAddr, 0, nil, &muteSize, &muted) == noErr
		var result: [String: Any] = ["deviceId": Int(deviceID)]
		if hasVolume {
			result["volume"] = Int(round(volume * 100))
			result["volumeScalar"] = volume
		}
		if hasMute { result["muted"] = muted != 0 }
		return json(["ok": true, "data": result])
	}

	static func audioSetVolume(body: Data?) -> Data {
		guard let level = intValue(body, key: "level"), (0...100).contains(level) else {
			return json(["ok": false, "error": "level must be 0-100"])
		}
		var deviceID: AudioObjectID = 0
		var size = UInt32(MemoryLayout<AudioObjectID>.size)
		var devAddr = audioAddr(selector: kAudioHardwarePropertyDefaultOutputDevice)
		guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &devAddr, 0, nil, &size, &deviceID) == noErr, deviceID != 0 else {
			return json(["ok": false, "error": "No default output device"])
		}
		var scalar = Float32(level) / 100.0
		let scope = kAudioObjectPropertyScopeOutput
		var volAddr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyVolumeScalar, mScope: scope, mElement: kAudioObjectPropertyElementMain)
		let volSize = UInt32(MemoryLayout<Float32>.size)
		let status = AudioObjectSetPropertyData(deviceID, &volAddr, 0, nil, volSize, &scalar)
		guard status == noErr else { return json(["ok": false, "error": "Failed to set volume: \(status)"]) }
		if level > 0 {
			var zeroMute: UInt32 = 0
			var muteAddr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyMute, mScope: scope, mElement: kAudioObjectPropertyElementMain)
			let muteSize = UInt32(MemoryLayout<UInt32>.size)
			AudioObjectSetPropertyData(deviceID, &muteAddr, 0, nil, muteSize, &zeroMute)
		}
		let data: [String: Any] = ["level": level, "deviceId": Int(deviceID)]
		return json(["ok": true, "data": data])
	}

	static func audioSetMute(body: Data?) -> Data {
		guard let muted = boolValue(body, key: "muted") else {
			return json(["ok": false, "error": "muted is required."])
		}
		var deviceID: AudioObjectID = 0
		var size = UInt32(MemoryLayout<AudioObjectID>.size)
		var devAddr = audioAddr(selector: kAudioHardwarePropertyDefaultOutputDevice)
		guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &devAddr, 0, nil, &size, &deviceID) == noErr, deviceID != 0 else {
			return json(["ok": false, "error": "No default output device"])
		}
		var mutedVal: UInt32 = muted ? 1 : 0
		let scope = kAudioObjectPropertyScopeOutput
		var muteAddr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyMute, mScope: scope, mElement: kAudioObjectPropertyElementMain)
		let muteSize = UInt32(MemoryLayout<UInt32>.size)
		let status = AudioObjectSetPropertyData(deviceID, &muteAddr, 0, nil, muteSize, &mutedVal)
		guard status == noErr else { return json(["ok": false, "error": "Failed to set mute: \(status)"]) }
		let data: [String: Any] = ["muted": muted, "deviceId": Int(deviceID)]
		return json(["ok": true, "data": data])
	}

	// MARK: - Bluetooth

	static func bluetoothStatus() -> Data {
		let powerState = IOBluetoothPreferenceGetControllerPowerState()
		let powerStateName: String
		switch powerState {
		case 1: powerStateName = "on"
		case 0: powerStateName = "off"
		case 2: powerStateName = "uninitialized"
		default: powerStateName = "unknown"
		}
		var data: [String: Any] = ["powerState": powerStateName, "powerStateRaw": powerState]
		let devices = IOBluetoothDevice.pairedDevices()
		var deviceList: [[String: Any]] = []
		for device in devices ?? [] {
			guard let d = device as? IOBluetoothDevice else { continue }
			var item: [String: Any] = [:]
			item["name"] = d.name ?? ""
			item["address"] = d.addressString ?? ""
			item["connected"] = d.isConnected()
			item["paired"] = d.isPaired()
			deviceList.append(item)
		}
		data["devices"] = deviceList
		data["deviceCount"] = deviceList.count
		return json(["ok": true, "data": data])
	}

	static func bluetoothSetPower(body: Data?) -> Data {
		guard let enabled = boolValue(body, key: "enabled") else {
			return json(["ok": false, "error": "enabled is required."])
		}
		IOBluetoothPreferenceSetControllerPowerState(enabled ? 1 : 0)
		usleep(500_000)
		let actualPower = IOBluetoothPreferenceGetControllerPowerState()
		let success = enabled ? (actualPower == 1) : (actualPower == 0)
		let data: [String: Any] = [
			"requested": enabled,
			"actual": actualPower == 1 ? "on" : (actualPower == 0 ? "off" : "unknown"),
			"success": success,
		]
		return json(["ok": true, "data": data])
	}

	// MARK: - Low power mode

	static func lowPowerStatus() -> Data {
		do {
			let output = try runProcess("/usr/bin/pmset", ["-g", "custom"])
			var lowPowerMode: String?
			for line in output.split(separator: "\n") {
				let trimmed = line.trimmingCharacters(in: .whitespaces)
				if trimmed.hasPrefix("lowpowermode") {
					let parts = trimmed.split(maxSplits: 1, whereSeparator: { $0.isWhitespace })
					if parts.count >= 2 { lowPowerMode = String(parts[1]) }
				}
			}
			var result: [String: Any] = [:]
			if let lpm = lowPowerMode {
				result["lowPowerMode"] = lpm
				result["enabled"] = lpm == "1"
			} else {
				result["lowPowerMode"] = "not reported"
				result["enabled"] = false
			}
			return json(["ok": true, "data": result])
		} catch {
			return json(["ok": false, "error": "pmset -g custom failed"])
		}
	}

	static func lowPowerSet(body: Data?) -> Data {
		guard let enabled = boolValue(body, key: "enabled") else {
			return json(["ok": false, "error": "enabled is required."])
		}
		let value = enabled ? "1" : "0"
		let process = Process()
		process.executableURL = URL(fileURLWithPath: "/usr/bin/pmset")
		process.arguments = ["-a", "lowpowermode", value]
		let errPipe = Pipe()
		process.standardOutput = FileHandle.nullDevice
		process.standardError = errPipe
		do {
			try process.run()
			process.waitUntilExit()
		} catch {
			return json(["ok": false, "error": "Failed to run pmset: \(error.localizedDescription)"])
		}
		if process.terminationStatus != 0 {
			let errData = errPipe.fileHandleForReading.readDataToEndOfFile()
			let errMsg = String(data: errData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "unknown error"
			return json(["ok": false, "error": "pmset lowpowermode failed: \(errMsg). May require admin privileges."])
		}
		let data: [String: Any] = ["lowPowerMode": value, "enabled": enabled]
		return json(["ok": true, "data": data])
	}

	// MARK: - Shortcuts

	static func shortcutsRun(body: Data?) -> Data {
		guard let name = stringValue(body, key: "name"), !name.isEmpty else {
			return json(["ok": false, "error": "name is required."])
		}
		let process = Process()
		process.executableURL = URL(fileURLWithPath: "/usr/bin/shortcuts")
		process.arguments = ["run", name]
		let outPipe = Pipe()
		let errPipe = Pipe()
		process.standardOutput = outPipe
		process.standardError = errPipe
		process.standardInput = FileHandle.nullDevice
		do {
			try process.run()
			process.waitUntilExit()
		} catch {
			return json(["ok": false, "error": "Failed to run shortcuts: \(error.localizedDescription)"])
		}
		let outData = outPipe.fileHandleForReading.readDataToEndOfFile()
		let errData = errPipe.fileHandleForReading.readDataToEndOfFile()
		let stdout = String(data: outData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		let stderr = String(data: errData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		if process.terminationStatus != 0 {
			return json(["ok": false, "error": "Shortcut \"\(name)\" failed: \(stderr.isEmpty ? "exit code \(process.terminationStatus)" : stderr)"])
		}
		let data: [String: Any] = ["shortcutName": name, "output": stdout]
		return json(["ok": true, "data": data])
	}

	// MARK: - Display brightness

	static func displayBrightness() -> Data {
		let serviceNames = ["IODisplayConnect", "AppleDisplay", "AppleBacklightDisplay", "AppleBacklight"]
		var displays: [[String: Any]] = []
		for serviceName in serviceNames {
			var iterator: io_iterator_t = 0
			let matchingDict = IOServiceMatching(serviceName)
			guard IOServiceGetMatchingServices(kIOMainPortDefault, matchingDict, &iterator) == KERN_SUCCESS else { continue }
			defer { IOObjectRelease(iterator) }
			var service = IOIteratorNext(iterator)
			while service != 0 {
				defer {
					IOObjectRelease(service)
					service = IOIteratorNext(iterator)
				}
				var val: Float32 = 0
				if IODisplayGetFloatParameterFunc(service, 0, kIODisplayBrightnessKey as CFString, &val) == KERN_SUCCESS {
					displays.append([
						"displayId": Int(service),
						"isMainDisplay": false,
						"brightness": Double(val),
						"percent": Int(round(Double(val) * 100)),
						"source": serviceName,
					])
				}
			}
			if !displays.isEmpty { break }
		}
		if displays.isEmpty {
			var onlineCount: UInt32 = 0
			var onlineIDs = [UInt32](repeating: 0, count: 16)
			if CGGetOnlineDisplayList(UInt32(onlineIDs.count), &onlineIDs, &onlineCount) == .success, onlineCount > 0 {
				return json(["ok": false, "error": "Display brightness reading is not supported on this hardware. Displays are online but brightness SPI is unavailable."])
			}
			return json(["ok": false, "error": "Could not read display brightness. No online displays found."])
		}
		return json(["ok": true, "data": ["displays": displays]])
	}

	static func displaySetBrightness(body: Data?) -> Data {
		guard let level = intValue(body, key: "level"), (0...100).contains(level) else {
			return json(["ok": false, "error": "level must be 0-100"])
		}
		let scalar = Float32(level) / 100.0
		let serviceNames = ["IODisplayConnect", "AppleDisplay", "AppleBacklightDisplay", "AppleBacklight"]
		for serviceName in serviceNames {
			var iterator: io_iterator_t = 0
			let matchingDict = IOServiceMatching(serviceName)
			guard IOServiceGetMatchingServices(kIOMainPortDefault, matchingDict, &iterator) == KERN_SUCCESS else { continue }
			defer { IOObjectRelease(iterator) }
			var didSet = false
			var service = IOIteratorNext(iterator)
			while service != 0 {
				defer {
					IOObjectRelease(service)
					service = IOIteratorNext(iterator)
				}
				if IODisplaySetFloatParameter(service, 0, kIODisplayBrightnessKey as CFString, scalar) == kIOReturnSuccess {
					didSet = true
				}
			}
			if didSet {
				return json(["ok": true, "data": ["level": level]])
			}
		}
		return json(["ok": false, "error": "Failed to set display brightness. This may not be supported on your hardware configuration."])
	}

	// MARK: - Clipboard

	static func clipboardRead() -> Data {
		let pasteboard = NSPasteboard.general
		guard let content = pasteboard.string(forType: .string) else {
			let types = pasteboard.types?.map { $0.rawValue } ?? []
			if types.isEmpty {
				return json(["ok": true, "data": ["text": "", "hasContent": false, "types": []]])
			}
			return json(["ok": true, "data": ["text": "", "hasContent": true, "types": types]])
		}
		let types = pasteboard.types?.map { $0.rawValue } ?? []
		return json(["ok": true, "data": ["text": content, "hasContent": true, "types": types]])
	}

	static func clipboardWrite(body: Data?) -> Data {
		guard let text = stringValue(body, key: "text"), !text.isEmpty else {
			return json(["ok": false, "error": "text is required and must not be empty"])
		}
		let pasteboard = NSPasteboard.general
		pasteboard.clearContents()
		pasteboard.setString(text, forType: .string)
		return json(["ok": true, "data": ["written": true]])
	}

	// MARK: - System info

	static func systemInfo() -> Data {
		var result: [String: Any] = [:]
		let swVers = try? runProcess("/usr/bin/sw_vers", [])
		result["osVersion"] = swVers ?? ""
		var size = 0
		sysctlbyname("hw.model", nil, &size, nil, 0)
		var model = [CChar](repeating: 0, count: size)
		sysctlbyname("hw.model", &model, &size, nil, 0)
		result["hardwareModel"] = stringFromCChars(model)
		var nameSize = 0
		sysctlbyname("hw.machine", nil, &nameSize, nil, 0)
		var machine = [CChar](repeating: 0, count: nameSize)
		sysctlbyname("hw.machine", &machine, &nameSize, nil, 0)
		let machineStr = stringFromCChars(machine)
		result["machine"] = machineStr
		result["hostname"] = Host.current().localizedName ?? ""
		result["hostName"] = ProcessInfo.processInfo.hostName
		result["uptimeSeconds"] = Int(ProcessInfo.processInfo.systemUptime)
		result["processorCount"] = ProcessInfo.processInfo.processorCount
		result["physicalMemoryMB"] = Int(ProcessInfo.processInfo.physicalMemory / 1_048_576)
		let osVersion = ProcessInfo.processInfo.operatingSystemVersion
		result["osVersionMajor"] = osVersion.majorVersion
		result["osVersionMinor"] = osVersion.minorVersion
		result["osVersionPatch"] = osVersion.patchVersion
		result["osVersionString"] = "\(osVersion.majorVersion).\(osVersion.minorVersion).\(osVersion.patchVersion)"
		result["isAppleSilicon"] = machineStr.hasPrefix("arm")
		return json(["ok": true, "data": result])
	}

	private static func stringFromCChars(_ chars: [CChar]) -> String {
		let bytes = chars.prefix(while: { $0 != 0 }).map { UInt8(truncatingIfNeeded: $0) }
		return String(decoding: bytes, as: UTF8.self)
	}

	// MARK: - Notifications

	static func notificationShow(body: Data?) async -> Data {
		guard let title = stringValue(body, key: "title")?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty else {
			return json(["ok": false, "error": "title is required."])
		}
		guard let description = stringValue(body, key: "description")?.trimmingCharacters(in: .whitespacesAndNewlines), !description.isEmpty else {
			return json(["ok": false, "error": "description is required."])
		}

		let ctas = stringArrayValue(body, key: "ctas")
			.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
			.filter { !$0.isEmpty }

		return await displayNotification(
			title: title,
			description: description,
			ctas: ctas
		)
	}

	private static func displayNotification(
		title: String,
		description: String,
		ctas: [String],
		userInfo: [String: Any] = [:]
	) async -> Data {
		let limitedCTAs = Array(ctas.prefix(4))

		let center = UNUserNotificationCenter.current()
		center.delegate = notificationDelegate
		do {
			let settings = await center.notificationSettings()
			if settings.authorizationStatus == .notDetermined {
				let granted = try await center.requestAuthorization(options: [.alert, .sound])
				guard granted else {
					return json(["ok": false, "error": "Notification permission was not granted.", "needsPermission": true])
				}
			} else if settings.authorizationStatus == .denied {
				return json(["ok": false, "error": "Notification permission is denied for Toby. Enable it in System Settings > Notifications.", "needsPermission": true])
			}

			let identifier = "toby.notification.\(UUID().uuidString)"
			let categoryIdentifier = "toby.notification.actions.\(UUID().uuidString)"
			if !limitedCTAs.isEmpty {
				let actions = limitedCTAs.enumerated().map { index, label in
					UNNotificationAction(
						identifier: "toby.notification.action.\(index)",
						title: label,
						options: [.foreground]
					)
				}
				center.setNotificationCategories([
					UNNotificationCategory(
						identifier: categoryIdentifier,
						actions: actions,
						intentIdentifiers: [],
						options: []
					),
				])
			}

			let content = UNMutableNotificationContent()
			content.title = title
			content.body = description
			content.sound = .default
			content.userInfo = userInfo
			if !limitedCTAs.isEmpty {
				content.categoryIdentifier = categoryIdentifier
			}

			let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
			try await center.add(request)
			return json(["ok": true, "data": ["identifier": identifier, "ctaCount": limitedCTAs.count, "presented": true]])
		} catch {
			return json(["ok": false, "error": "Failed to display notification: \(error.localizedDescription)"])
		}
	}

	@MainActor
	static func scheduleCompletionNotification(body: Data?) async -> Data {
		guard let scheduleId = stringValue(body, key: "scheduleId")?.trimmingCharacters(in: .whitespacesAndNewlines), !scheduleId.isEmpty else {
			return json(["ok": false, "error": "scheduleId is required."])
		}
		let scheduleName = stringValue(body, key: "scheduleName")?.trimmingCharacters(in: .whitespacesAndNewlines)
		let displayName = if let scheduleName, !scheduleName.isEmpty {
			scheduleName
		} else {
			"Untitled schedule"
		}
		let runId = stringValue(body, key: "runId")?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		let status = stringValue(body, key: "status")?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
		let error = stringValue(body, key: "error")?.trimmingCharacters(in: .whitespacesAndNewlines)

		let isSuccess = status == "success"
		let title = isSuccess ? "Schedule completed" : "Schedule failed"
		let description = isSuccess
			? "\(displayName) finished successfully."
			: "\(displayName) failed: \(error?.isEmpty == false ? error! : "Unknown error")"

		return await displayNotification(
			title: title,
			description: description,
			ctas: ["View schedule"],
			userInfo: [
				"type": "scheduleCompletion",
				"scheduleId": scheduleId,
				"scheduleName": displayName,
				"runId": runId,
				"status": isSuccess ? "success" : "error",
			]
		)
	}

	// MARK: - Window minimize all

	static func minimizeAll() -> Data {
		guard ensureAccessibility() else {
			return json(["ok": false, "error": "Accessibility permission is required to minimize windows. Grant access to Toby in System Settings > Privacy & Security > Accessibility.", "needsPermission": true])
		}
		let apps = regularApps()
		let frontmost = NSWorkspace.shared.frontmostApplication
		var minimizedWindowCount = 0
		var touchedApps: [String] = []
		var skippedApps: [String] = []
		for app in apps {
			if let front = frontmost, front.processIdentifier == app.processIdentifier { continue }
			let result = minimizeWindows(for: app.processIdentifier)
			if result.minimized > 0 {
				minimizedWindowCount += result.minimized
				if let name = app.localizedName { touchedApps.append(name) }
			} else if !result.hadWindows, let name = app.localizedName {
				skippedApps.append(name)
			}
		}
		return json(["ok": true, "data": ["minimizedWindowCount": minimizedWindowCount, "apps": touchedApps, "appsWithoutWindows": skippedApps]])
	}

	// MARK: - Unminimize all

	static func unminimizeAll() -> Data {
		guard ensureAccessibility() else {
			return json(["ok": false, "error": "Accessibility permission is required to unminimize windows. Grant access to Toby in System Settings > Privacy & Security > Accessibility.", "needsPermission": true])
		}
		let apps = regularApps()
		var unminimizedWindowCount = 0
		var touchedApps: [String] = []
		var skippedApps: [String] = []
		for app in apps {
			let result = unminimizeWindows(for: app.processIdentifier)
			if result.unminimized > 0 {
				unminimizedWindowCount += result.unminimized
				if let name = app.localizedName { touchedApps.append(name) }
			} else if !result.hadWindows, let name = app.localizedName {
				skippedApps.append(name)
			}
		}
		return json(["ok": true, "data": ["unminimizedWindowCount": unminimizedWindowCount, "apps": touchedApps, "appsWithoutWindows": skippedApps]])
	}

	// MARK: - Minimize app

	static func minimizeApp(body: Data?) -> Data {
		guard ensureAccessibility() else {
			return json(["ok": false, "error": "Accessibility permission is required to minimize windows. Grant access to Toby in System Settings > Privacy & Security > Accessibility.", "needsPermission": true])
		}
		guard let name = stringValue(body, key: "name"), !name.isEmpty else {
			return json(["ok": false, "error": "name is required."])
		}
		let matches = matchApps(name: name)
		guard !matches.isEmpty else {
			return json(["ok": false, "error": "No running application matched \"\(name)\"."])
		}
		var minimizedWindowCount = 0
		var touchedApps: [String] = []
		for app in matches {
			let result = minimizeWindows(for: app.processIdentifier)
			if result.minimized > 0 {
				minimizedWindowCount += result.minimized
				if let n = app.localizedName { touchedApps.append(n) }
			}
		}
		return json(["ok": true, "data": ["minimizedWindowCount": minimizedWindowCount, "apps": touchedApps]])
	}

	// MARK: - Unminimize app

	static func unminimizeApp(body: Data?) -> Data {
		guard ensureAccessibility() else {
			return json(["ok": false, "error": "Accessibility permission is required to unminimize windows. Grant access to Toby in System Settings > Privacy & Security > Accessibility.", "needsPermission": true])
		}
		guard let name = stringValue(body, key: "name"), !name.isEmpty else {
			return json(["ok": false, "error": "name is required."])
		}
		let matches = matchApps(name: name)
		guard !matches.isEmpty else {
			return json(["ok": false, "error": "No running application matched \"\(name)\"."])
		}
		var unminimizedWindowCount = 0
		var touchedApps: [String] = []
		for app in matches {
			let result = unminimizeWindows(for: app.processIdentifier)
			if result.unminimized > 0 {
				unminimizedWindowCount += result.unminimized
				if let n = app.localizedName { touchedApps.append(n) }
			}
		}
		return json(["ok": true, "data": ["unminimizedWindowCount": unminimizedWindowCount, "apps": touchedApps]])
	}

	// MARK: - Window hide/show (no Accessibility required)

	static func windowsHideAll() -> Data {
		let apps = regularApps()
		let frontmost = NSWorkspace.shared.frontmostApplication
		var hiddenNames: [String] = []
		for app in apps {
			if let front = frontmost, front.processIdentifier == app.processIdentifier { continue }
			if app.isHidden { continue }
			if app.hide() {
				if let name = app.localizedName { hiddenNames.append(name) }
			}
		}
		return json(["ok": true, "data": ["hiddenCount": hiddenNames.count, "hiddenApps": hiddenNames]])
	}

	static func windowsShowAll() -> Data {
		let apps = regularApps()
		var shownNames: [String] = []
		for app in apps where app.isHidden {
			if app.unhide() {
				if let name = app.localizedName { shownNames.append(name) }
			}
		}
		return json(["ok": true, "data": ["shownCount": shownNames.count, "shownApps": shownNames]])
	}

	static func windowHideApp(body: Data?) -> Data {
		guard let name = stringValue(body, key: "appName"), !name.isEmpty else {
			return json(["ok": false, "error": "appName is required."])
		}
		let matches = matchApps(name: name)
		guard !matches.isEmpty else {
			return json(["ok": false, "error": "No running application matched \"\(name)\"."])
		}
		var hiddenNames: [String] = []
		for app in matches {
			if app.isHidden { continue }
			if app.hide() {
				if let n = app.localizedName { hiddenNames.append(n) }
			}
		}
		return json(["ok": true, "data": ["hiddenCount": hiddenNames.count, "hiddenApps": hiddenNames]])
	}

	// MARK: - Helpers

	private static func ensureAccessibility() -> Bool {
		if AXIsProcessTrusted() { return true }
		let options: CFDictionary = ["AXTrustedCheckOptionPrompt": kCFBooleanTrue!] as CFDictionary
		_ = AXIsProcessTrustedWithOptions(options)
		return false
	}

	private static func regularApps() -> [NSRunningApplication] {
		NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
	}

	private static func matchApps(name: String) -> [NSRunningApplication] {
		let needle = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
		guard !needle.isEmpty else { return [] }
		return regularApps().filter { app in
			let local = app.localizedName?.lowercased() ?? ""
			let bundle = app.bundleIdentifier?.lowercased() ?? ""
			return local == needle || local.contains(needle) || bundle.contains(needle)
		}
	}

	private struct MinimizeResult {
		let minimized: Int
		let hadWindows: Bool
	}

	private struct UnminimizeResult {
		let unminimized: Int
		let hadWindows: Bool
	}

	private static func minimizeWindows(for pid: pid_t) -> MinimizeResult {
		let appElement = AXUIElementCreateApplication(pid)
		var windowsRef: CFTypeRef?
		let status = AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &windowsRef)
		if status != .success {
			return MinimizeResult(minimized: 0, hadWindows: false)
		}
		guard let windows = windowsRef as? [AXUIElement], !windows.isEmpty else {
			return MinimizeResult(minimized: 0, hadWindows: false)
		}
		var count = 0
		for window in windows {
			var minimizedRef: CFTypeRef?
			let getStatus = AXUIElementCopyAttributeValue(window, kAXMinimizedAttribute as CFString, &minimizedRef)
			if getStatus == .success, let already = minimizedRef as? Bool, already { continue }
			let setStatus = AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanTrue)
			if setStatus == .success { count += 1 }
		}
		return MinimizeResult(minimized: count, hadWindows: true)
	}

	private static func unminimizeWindows(for pid: pid_t) -> UnminimizeResult {
		let appElement = AXUIElementCreateApplication(pid)
		var windowsRef: CFTypeRef?
		let status = AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &windowsRef)
		if status != .success {
			return UnminimizeResult(unminimized: 0, hadWindows: false)
		}
		guard let windows = windowsRef as? [AXUIElement], !windows.isEmpty else {
			return UnminimizeResult(unminimized: 0, hadWindows: false)
		}
		var count = 0
		for window in windows {
			var minimizedRef: CFTypeRef?
			let getStatus = AXUIElementCopyAttributeValue(window, kAXMinimizedAttribute as CFString, &minimizedRef)
			if getStatus == .success, let already = minimizedRef as? Bool, !already { continue }
			let setStatus = AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
			if setStatus == .success { count += 1 }
		}
		return UnminimizeResult(unminimized: count, hadWindows: true)
	}

	// MARK: - Body parsing helpers

	private static func stringValue(_ body: Data?, key: String) -> String? {
		guard let body,
			let input = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
			let value = input[key] as? String
		else { return nil }
		return value
	}

	private static func intValue(_ body: Data?, key: String) -> Int? {
		guard let body,
			let input = try? JSONSerialization.jsonObject(with: body) as? [String: Any]
		else { return nil }
		if let n = input[key] as? Int { return n }
		if let d = input[key] as? Double { return Int(d) }
		if let n = input[key] as? NSNumber { return n.intValue }
		return nil
	}

	private static func boolValue(_ body: Data?, key: String) -> Bool? {
		guard let body,
			let input = try? JSONSerialization.jsonObject(with: body) as? [String: Any]
		else { return nil }
		if let b = input[key] as? Bool { return b }
		if let n = input[key] as? NSNumber { return n.boolValue }
		return nil
	}

	private static func stringArrayValue(_ body: Data?, key: String) -> [String] {
		guard let body,
			let input = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
			let values = input[key] as? [Any]
		else { return [] }
		return values.compactMap { $0 as? String }
	}

	// MARK: - Process runner

	private static func runProcess(_ path: String, _ args: [String]) throws -> String {
		let process = Process()
		process.executableURL = URL(fileURLWithPath: path)
		process.arguments = args
		let pipe = Pipe()
		process.standardOutput = pipe
		process.standardError = FileHandle.nullDevice
		try process.run()
		process.waitUntilExit()
		let data = pipe.fileHandleForReading.readDataToEndOfFile()
		return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
	}

	// MARK: - JSON helper

	private static func json(_ payload: [String: Any]) -> Data {
		guard JSONSerialization.isValidJSONObject(payload),
			let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
		else {
			return Data("{\"ok\":false,\"error\":\"encoding error\"}".utf8)
		}
		return data
	}
}
