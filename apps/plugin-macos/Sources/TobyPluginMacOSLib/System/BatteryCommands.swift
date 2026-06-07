import Foundation
import IOKit
import IOKit.ps

enum BatteryCommands {
	static func statusData() throws -> [String: Any] {
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

			if let charge = info[kIOPSCurrentCapacityKey as String] as? Int {
				batteryInfo["chargePercent"] = charge
			}
			if let maxCap = info[kIOPSMaxCapacityKey as String] as? Int {
				batteryInfo["maxCapacity"] = maxCap
			}
			if let isCharging = info[kIOPSIsChargingKey as String] as? Bool {
				batteryInfo["isCharging"] = isCharging
			}
			if let state = info[kIOPSPowerSourceStateKey as String] as? String {
				batteryInfo["powerSourceState"] = state
			}
			if let timeRemaining = info[kIOPSTimeToEmptyKey as String] as? Int {
				batteryInfo["timeToEmptyMinutes"] = timeRemaining
			}
			if let timeToFull = info[kIOPSTimeToFullChargeKey as String] as? Int {
				batteryInfo["timeToFullChargeMinutes"] = timeToFull
			}
			if let isPresent = info[kIOPSIsPresentKey as String] as? Bool {
				batteryInfo["isPresent"] = isPresent
			}

			if let cycleCount = readCycleCount() {
				batteryInfo["cycleCount"] = cycleCount
			}

			break
		}

		if batteryInfo.isEmpty {
			throw HelperError.runtime("No internal battery found (desktop Mac?)")
		}

		return batteryInfo
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
}
