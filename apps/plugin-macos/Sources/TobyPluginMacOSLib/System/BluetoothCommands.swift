import Foundation
import IOBluetooth

@_silgen_name("IOBluetoothPreferenceSetControllerPowerState")
func IOBluetoothPreferenceSetControllerPowerState(_ state: UInt32)
@_silgen_name("IOBluetoothPreferenceGetControllerPowerState")
func IOBluetoothPreferenceGetControllerPowerState() -> UInt32

enum BluetoothCommands {
	static func statusData() throws -> [String: Any] {
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
		return data
	}

	static func setPower(enabled: Bool) throws -> [String: Any] {
		IOBluetoothPreferenceSetControllerPowerState(enabled ? 1 : 0)
		usleep(500_000)
		let actualPower = IOBluetoothPreferenceGetControllerPowerState()
		let success = enabled ? (actualPower == 1) : (actualPower == 0)
		return [
			"requested": enabled,
			"actual": actualPower == 1 ? "on" : (actualPower == 0 ? "off" : "unknown"),
			"success": success,
		]
	}
}
