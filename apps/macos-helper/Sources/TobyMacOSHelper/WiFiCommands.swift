import CoreWLAN
import Foundation

enum WiFiCommands {
	static func status() throws {
		let client = CWWiFiClient.shared()
		guard let interface = client.interface() else {
			throw HelperError.runtime("No Wi-Fi interface found")
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
		JSONOutput.success(data)
	}

	static func scan() throws {
		let client = CWWiFiClient.shared()
		guard let interface = client.interface() else {
			throw HelperError.runtime("No Wi-Fi interface found")
		}
		guard interface.powerOn() else {
			throw HelperError.runtime("Wi-Fi is off. Turn it on before scanning.")
		}
		let networks: Set<CWNetwork>
		do {
			networks = try interface.scanForNetworks(withSSID: nil)
		} catch {
			throw HelperError.runtime("Wi-Fi scan failed: \(error.localizedDescription)")
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
		JSONOutput.success([
			"interface": interface.interfaceName ?? "unknown",
			"networks": items,
			"count": items.count,
		])
	}

	static func power(_ parser: inout ArgParser) throws {
		let on = parser.parseFlag("--on")
		let off = parser.parseFlag("--off")
		guard on || off else {
			throw HelperError.usage("Specify --on or --off")
		}
		let enabled = on
		let client = CWWiFiClient.shared()
		guard let interface = client.interface() else {
			throw HelperError.runtime("No Wi-Fi interface found")
		}
		do {
			try interface.setPower(enabled)
			JSONOutput.success([
				"interface": interface.interfaceName ?? "unknown",
				"enabled": enabled,
			])
		} catch {
			throw HelperError.runtime("Failed to \(enabled ? "enable" : "disable") Wi-Fi: \(error.localizedDescription)")
		}
	}
}
