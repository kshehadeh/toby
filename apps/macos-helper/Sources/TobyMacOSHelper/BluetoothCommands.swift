import Foundation
import IOBluetooth

// IOBluetoothPreference C functions — available in IOBluetooth framework but not auto-bridged
@_silgen_name("IOBluetoothPreferenceSetControllerPowerState")
func IOBluetoothPreferenceSetControllerPowerState(_ state: UInt32)
@_silgen_name("IOBluetoothPreferenceGetControllerPowerState")
func IOBluetoothPreferenceGetControllerPowerState() -> UInt32

enum BluetoothCommands {
	static func status() throws {
		let powerState = IOBluetoothPreferenceGetControllerPowerState()
		let powerStateName: String
		switch powerState {
		case 1:
			powerStateName = "on"
		case 0:
			powerStateName = "off"
		case 2:
			powerStateName = "uninitialized"
		default:
			powerStateName = "unknown"
		}

		var data: [String: Any] = [
			"powerState": powerStateName,
			"powerStateRaw": powerState,
		]

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

		JSONOutput.success(data)
	}

	static func power(_ parser: inout ArgParser) throws {
		let on = parser.parseFlag("--on")
		let off = parser.parseFlag("--off")
		guard on || off else {
			throw HelperError.usage("Specify --on or --off")
		}
		let enabled = on

		IOBluetoothPreferenceSetControllerPowerState(enabled ? 1 : 0)

		// Brief wait and read back
		usleep(500_000)
		let actualPower = IOBluetoothPreferenceGetControllerPowerState()
		let success = enabled ? (actualPower == 1) : (actualPower == 0)

		JSONOutput.success([
			"requested": enabled,
			"actual": actualPower == 1 ? "on" : (actualPower == 0 ? "off" : "unknown"),
			"success": success,
		])
	}
}
