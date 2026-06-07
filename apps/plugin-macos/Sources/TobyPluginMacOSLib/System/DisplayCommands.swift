import CoreGraphics
import Foundation
import IOKit

@_silgen_name("IODisplayGetFloatParameter")
func IODisplayGetFloatParameterFunc(_ service: io_object_t, _ options: UInt32, _ paramName: CFString, _ value: UnsafeMutablePointer<Float32>) -> kern_return_t

enum DisplayCommands {
	static func brightnessData() throws -> [String: Any] {
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
				throw HelperError.runtime("Display brightness reading is not supported on this hardware. Displays are online but brightness SPI is unavailable.")
			}
			throw HelperError.runtime("Could not read display brightness. No online displays found.")
		}

		return ["displays": displays]
	}

	static func setBrightness(level: Int) throws -> [String: Any] {
		guard (0...100).contains(level) else {
			throw HelperError.usage("level must be 0-100")
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
				return ["level": level]
			}
		}

		throw HelperError.runtime("Failed to set display brightness. This may not be supported on your hardware configuration.")
	}
}
