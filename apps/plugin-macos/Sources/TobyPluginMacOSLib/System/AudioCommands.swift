import CoreAudio
import Foundation

enum AudioCommands {
	private static let kDeviceUID: AudioObjectPropertySelector = 0x75696420
	private static func addr(selector: AudioObjectPropertySelector, scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
		AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
	}

	static func listData() throws -> [String: Any] {
		var address = addr(selector: kAudioHardwarePropertyDevices)
		var size: UInt32 = 0
		var status = AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size)
		guard status == noErr else {
			throw HelperError.runtime("Could not get audio device list size: \(status)")
		}
		let count = Int(size) / MemoryLayout<AudioObjectID>.size
		var ids = [AudioObjectID](repeating: 0, count: count)
		status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &ids)
		guard status == noErr else {
			throw HelperError.runtime("Could not get audio device list: \(status)")
		}

		var defaultOutputID: AudioObjectID = 0
		var defaultInputID: AudioObjectID = 0
		var defaultSize = UInt32(MemoryLayout<AudioObjectID>.size)

		var outAddr = addr(selector: kAudioHardwarePropertyDefaultOutputDevice)
		AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &outAddr, 0, nil, &defaultSize, &defaultOutputID)

		var inAddr = addr(selector: kAudioHardwarePropertyDefaultInputDevice)
		AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &inAddr, 0, nil, &defaultSize, &defaultInputID)

		var outputs: [[String: Any]] = []
		var inputs: [[String: Any]] = []

		for id in ids {
			guard let info = deviceInfo(id: id, defaultOutputID: defaultOutputID, defaultInputID: defaultInputID) else { continue }
			if info["isOutput"] as? Bool == true {
				outputs.append(info)
			}
			if info["isInput"] as? Bool == true {
				inputs.append(info)
			}
		}

		return [
			"outputs": outputs,
			"inputs": inputs,
			"defaultOutputId": Int(defaultOutputID),
			"defaultInputId": Int(defaultInputID),
		]
	}

	private static func deviceInfo(id: AudioObjectID, defaultOutputID: AudioObjectID, defaultInputID: AudioObjectID) -> [String: Any]? {
		var nameSize = UInt32(0)
		var nameAddr = addr(selector: kAudioDevicePropertyDeviceNameCFString)
		guard AudioObjectGetPropertyDataSize(id, &nameAddr, 0, nil, &nameSize) == noErr else { return nil }
		var nameRef: CFString?
		guard AudioObjectGetPropertyData(id, &nameAddr, 0, nil, &nameSize, &nameRef) == noErr, let name = nameRef as String? else { return nil }

		var uidRef: CFString?
		var uidAddr = addr(selector: kDeviceUID)
		var uidSize = UInt32(MemoryLayout<CFString>.size)
		AudioObjectGetPropertyData(id, &uidAddr, 0, nil, &uidSize, &uidRef)
		let uid = uidRef as String? ?? ""

		let isOutput = hasStreams(id: id, scope: kAudioObjectPropertyScopeOutput)
		let isInput = hasStreams(id: id, scope: kAudioObjectPropertyScopeInput)

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
		var srAddr = addr(selector: kAudioDevicePropertyNominalSampleRate)
		if AudioObjectGetPropertyData(id, &srAddr, 0, nil, &srSize, &sampleRate) == noErr {
			info["sampleRate"] = sampleRate
		}

		return info
	}

	private static func hasStreams(id: AudioObjectID, scope: AudioObjectPropertyScope) -> Bool {
		var addr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreamConfiguration, mScope: scope, mElement: kAudioObjectPropertyElementMain)
		var size: UInt32 = 0
		guard AudioObjectGetPropertyDataSize(id, &addr, 0, nil, &size) == noErr else { return false }
		guard let buffer = malloc(Int(size)) else { return false }
		defer { free(buffer) }
		guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, buffer) == noErr else { return false }
		let list = buffer.assumingMemoryBound(to: AudioBufferList.self)
		return list.pointee.mNumberBuffers > 0
	}

	static func switchOutput(device nameOrUid: String) throws -> [String: Any] {
		var address = addr(selector: kAudioHardwarePropertyDevices)
		var size: UInt32 = 0
		var status = AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size)
		guard status == noErr else {
			throw HelperError.runtime("Could not get audio device list: \(status)")
		}
		let count = Int(size) / MemoryLayout<AudioObjectID>.size
		var ids = [AudioObjectID](repeating: 0, count: count)
		status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &ids)
		guard status == noErr else {
			throw HelperError.runtime("Could not get audio device list: \(status)")
		}

		var matchedID: AudioObjectID?

		for id in ids {
			guard id != 0 else { continue }
			var uidRef: CFString?
			var uidAddr = addr(selector: kDeviceUID)
			var uidSize = UInt32(MemoryLayout<CFString>.size)
			if AudioObjectGetPropertyData(id, &uidAddr, 0, nil, &uidSize, &uidRef) == noErr,
				let uid = uidRef as String?,
				(uid == nameOrUid || uid.contains(nameOrUid))
			{
				matchedID = id
				break
			}
			var nameSize = UInt32(0)
			var nameAddr = addr(selector: kAudioDevicePropertyDeviceNameCFString)
			if AudioObjectGetPropertyDataSize(id, &nameAddr, 0, nil, &nameSize) == noErr {
				var nameRef: CFString?
				if AudioObjectGetPropertyData(id, &nameAddr, 0, nil, &nameSize, &nameRef) == noErr,
					let name = nameRef as String?,
					(name == nameOrUid || name.localizedCaseInsensitiveContains(nameOrUid))
				{
					matchedID = id
					break
				}
			}
		}

		guard let targetID = matchedID else {
			throw HelperError.runtime("No audio device found matching \"\(nameOrUid)\"")
		}

		var newDefault = targetID
		var setAddr = addr(selector: kAudioHardwarePropertyDefaultOutputDevice)
		var setSize = UInt32(MemoryLayout<AudioObjectID>.size)
		status = AudioObjectSetPropertyData(AudioObjectID(kAudioObjectSystemObject), &setAddr, 0, nil, setSize, &newDefault)
		guard status == noErr else {
			throw HelperError.runtime("Failed to set default output device: \(status)")
		}

		var nameSize = UInt32(0)
		var nameAddr = addr(selector: kAudioDevicePropertyDeviceNameCFString)
		AudioObjectGetPropertyDataSize(targetID, &nameAddr, 0, nil, &nameSize)
		var nameRef: CFString?
		AudioObjectGetPropertyData(targetID, &nameAddr, 0, nil, &nameSize, &nameRef)
		let name = nameRef as String? ?? "unknown"

		return [
			"deviceId": Int(targetID),
			"name": name,
		]
	}

	static func volumeData() throws -> [String: Any] {
		var deviceID: AudioObjectID = 0
		var size = UInt32(MemoryLayout<AudioObjectID>.size)
		var addr = addr(selector: kAudioHardwarePropertyDefaultOutputDevice)
		guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &deviceID) == noErr, deviceID != 0 else {
			throw HelperError.runtime("No default output device")
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
		if hasMute {
			result["muted"] = muted != 0
		}
		return result
	}

	static func setVolume(level: Int) throws -> [String: Any] {
		guard (0...100).contains(level) else {
			throw HelperError.usage("level must be 0-100")
		}

		var deviceID: AudioObjectID = 0
		var size = UInt32(MemoryLayout<AudioObjectID>.size)
		var devAddr = addr(selector: kAudioHardwarePropertyDefaultOutputDevice)
		guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &devAddr, 0, nil, &size, &deviceID) == noErr, deviceID != 0 else {
			throw HelperError.runtime("No default output device")
		}

		var scalar = Float32(level) / 100.0
		let scope = kAudioObjectPropertyScopeOutput
		var volAddr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyVolumeScalar, mScope: scope, mElement: kAudioObjectPropertyElementMain)
		var volSize = UInt32(MemoryLayout<Float32>.size)
		let status = AudioObjectSetPropertyData(deviceID, &volAddr, 0, nil, volSize, &scalar)
		guard status == noErr else {
			throw HelperError.runtime("Failed to set volume: \(status)")
		}

		if level > 0 {
			var zeroMute: UInt32 = 0
			var muteAddr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyMute, mScope: scope, mElement: kAudioObjectPropertyElementMain)
			let muteSize = UInt32(MemoryLayout<UInt32>.size)
			AudioObjectSetPropertyData(deviceID, &muteAddr, 0, nil, muteSize, &zeroMute)
		}

		return ["level": level, "deviceId": Int(deviceID)]
	}

	static func setMute(muted: Bool) throws -> [String: Any] {
		var deviceID: AudioObjectID = 0
		var size = UInt32(MemoryLayout<AudioObjectID>.size)
		var devAddr = addr(selector: kAudioHardwarePropertyDefaultOutputDevice)
		guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &devAddr, 0, nil, &size, &deviceID) == noErr, deviceID != 0 else {
			throw HelperError.runtime("No default output device")
		}

		var mutedVal: UInt32 = muted ? 1 : 0
		let scope = kAudioObjectPropertyScopeOutput
		var muteAddr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyMute, mScope: scope, mElement: kAudioObjectPropertyElementMain)
		let muteSize = UInt32(MemoryLayout<UInt32>.size)
		let status = AudioObjectSetPropertyData(deviceID, &muteAddr, 0, nil, muteSize, &mutedVal)
		guard status == noErr else {
			throw HelperError.runtime("Failed to set mute: \(status)")
		}

		return ["muted": muted, "deviceId": Int(deviceID)]
	}
}
