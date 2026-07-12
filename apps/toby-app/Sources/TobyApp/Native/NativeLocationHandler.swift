import CoreLocation
import Foundation

/// CoreLocation bridge for the Toby.app native API.
///
/// Location Services prompts are tied to Toby.app's bundle identity. One-shot
/// reads request authorization when needed, then call `requestLocation()`.
@MainActor
final class NativeLocationHandler: NSObject, CLLocationManagerDelegate {
	static let shared = NativeLocationHandler()

	private let manager = CLLocationManager()
	private var locationContinuation: CheckedContinuation<CLLocation, Error>?
	private var authContinuation: CheckedContinuation<CLAuthorizationStatus, Never>?
	private var locationTimeoutTask: Task<Void, Never>?

	private override init() {
		super.init()
		manager.delegate = self
		manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
	}

	// MARK: - Public API

	func status() -> Data {
		let auth = currentAuthorizationStatus()
		return json([
			"ok": true,
			"data": [
				"authorizationStatus": authorizationStatusString(auth),
				"granted": isGranted(auth),
				"servicesEnabled": CLLocationManager.locationServicesEnabled(),
			],
		])
	}

	func requestAccess() async -> Data {
		guard CLLocationManager.locationServicesEnabled() else {
			return json([
				"ok": false,
				"error": "Location Services are disabled system-wide. Enable them in System Settings → Privacy & Security → Location Services.",
				"needsPermission": true,
				"data": [
					"prompted": false,
					"granted": false,
					"authorizationStatus": authorizationStatusString(currentAuthorizationStatus()),
					"servicesEnabled": false,
				],
			])
		}

		let before = currentAuthorizationStatus()
		if isGranted(before) {
			return json([
				"ok": true,
				"data": [
					"prompted": false,
					"granted": true,
					"authorizationStatus": authorizationStatusString(before),
					"servicesEnabled": true,
				],
			])
		}

		if isDenied(before) {
			return json([
				"ok": false,
				"error": "Location access denied. Enable Location Services for Toby in System Settings → Privacy & Security → Location Services.",
				"needsPermission": true,
				"data": [
					"prompted": false,
					"granted": false,
					"authorizationStatus": authorizationStatusString(before),
					"servicesEnabled": true,
				],
			])
		}

		let after = await promptForAuthorization()
		if isGranted(after) {
			return json([
				"ok": true,
				"data": [
					"prompted": true,
					"granted": true,
					"authorizationStatus": authorizationStatusString(after),
					"servicesEnabled": true,
				],
			])
		}

		return json([
			"ok": false,
			"error": "Location access denied.",
			"needsPermission": true,
			"data": [
				"prompted": true,
				"granted": false,
				"authorizationStatus": authorizationStatusString(after),
				"servicesEnabled": true,
			],
		])
	}

	func currentLocation(body: Data?) async -> Data {
		let input = jsonInput(body) ?? [:]
		let shouldReverseGeocode = boolValue(input["reverseGeocode"]) ?? true
		applyAccuracy(stringValue(input["accuracy"]))

		guard CLLocationManager.locationServicesEnabled() else {
			return json([
				"ok": false,
				"error": "Location Services are disabled system-wide. Enable them in System Settings → Privacy & Security → Location Services.",
				"needsPermission": true,
			])
		}

		var auth = currentAuthorizationStatus()
		if !isGranted(auth) {
			if isDenied(auth) {
				return json([
					"ok": false,
					"error": "Location access denied. Enable Location Services for Toby in System Settings → Privacy & Security → Location Services.",
					"needsPermission": true,
				])
			}
			auth = await promptForAuthorization()
			if !isGranted(auth) {
				return json([
					"ok": false,
					"error": "Location access denied.",
					"needsPermission": true,
				])
			}
		}

		do {
			let location = try await requestOneShotLocation()
			var data: [String: Any] = locationDict(location)

			if shouldReverseGeocode {
				if let place = await reverseGeocodePlace(location) {
					data["place"] = place
				}
			}

			return json(["ok": true, "data": data])
		} catch let error as LocationError {
			return json(["ok": false, "error": error.message, "needsPermission": error.needsPermission])
		} catch {
			return json(["ok": false, "error": error.localizedDescription])
		}
	}

	// MARK: - Authorization helpers

	private func currentAuthorizationStatus() -> CLAuthorizationStatus {
		manager.authorizationStatus
	}

	private func isGranted(_ status: CLAuthorizationStatus) -> Bool {
		switch status {
		case .authorizedAlways, .authorizedWhenInUse:
			return true
		default:
			return false
		}
	}

	private func isDenied(_ status: CLAuthorizationStatus) -> Bool {
		status == .denied || status == .restricted
	}

	private func authorizationStatusString(_ status: CLAuthorizationStatus) -> String {
		switch status {
		case .notDetermined: return "notDetermined"
		case .restricted: return "restricted"
		case .denied: return "denied"
		case .authorizedAlways: return "authorizedAlways"
		case .authorizedWhenInUse: return "authorizedWhenInUse"
		@unknown default: return "unknown"
		}
	}

	private func promptForAuthorization() async -> CLAuthorizationStatus {
		let current = currentAuthorizationStatus()
		if current != .notDetermined {
			return current
		}

		return await withCheckedContinuation { continuation in
			// If a prior prompt is still pending, finish it with current status.
			if let existing = authContinuation {
				authContinuation = nil
				existing.resume(returning: currentAuthorizationStatus())
			}
			authContinuation = continuation
			manager.requestWhenInUseAuthorization()
		}
	}

	// MARK: - Location helpers

	private func applyAccuracy(_ raw: String?) {
		switch raw?.lowercased() {
		case "best":
			manager.desiredAccuracy = kCLLocationAccuracyBest
		case "kilometer", "km":
			manager.desiredAccuracy = kCLLocationAccuracyKilometer
		case "nearesttenmeters", "tenmeters":
			manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
		default:
			manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
		}
	}

	private func requestOneShotLocation() async throws -> CLLocation {
		try await withCheckedThrowingContinuation { continuation in
			if let existing = locationContinuation {
				locationContinuation = nil
				existing.resume(throwing: LocationError(message: "Superseded by a newer location request.", needsPermission: false))
			}
			locationContinuation = continuation
			locationTimeoutTask?.cancel()
			locationTimeoutTask = Task { @MainActor in
				try? await Task.sleep(nanoseconds: 20_000_000_000)
				guard !Task.isCancelled else { return }
				if let pending = self.locationContinuation {
					self.locationContinuation = nil
					pending.resume(
						throwing: LocationError(
							message: "Timed out waiting for a location fix. Ensure Location Services are on and the Mac can determine its position.",
							needsPermission: false,
						)
					)
				}
			}
			manager.requestLocation()
		}
	}

	private func locationDict(_ location: CLLocation) -> [String: Any] {
		var dict: [String: Any] = [
			"latitude": location.coordinate.latitude,
			"longitude": location.coordinate.longitude,
			"horizontalAccuracyMeters": location.horizontalAccuracy,
			"timestamp": ISO8601DateFormatter().string(from: location.timestamp),
		]
		if location.verticalAccuracy >= 0 {
			dict["altitudeMeters"] = location.altitude
			dict["verticalAccuracyMeters"] = location.verticalAccuracy
		}
		if location.speed >= 0 {
			dict["speedMetersPerSecond"] = location.speed
		}
		if location.course >= 0 {
			dict["courseDegrees"] = location.course
		}
		return dict
	}

	private func reverseGeocodePlace(_ location: CLLocation) async -> [String: Any]? {
		let geocoder = CLGeocoder()
		do {
			let placemarks = try await geocoder.reverseGeocodeLocation(location)
			guard let placemark = placemarks.first else { return nil }
			var place: [String: Any] = [:]
			if let name = placemark.name, !name.isEmpty { place["name"] = name }
			if let thoroughfare = placemark.thoroughfare, !thoroughfare.isEmpty {
				place["thoroughfare"] = thoroughfare
			}
			if let subThoroughfare = placemark.subThoroughfare, !subThoroughfare.isEmpty {
				place["subThoroughfare"] = subThoroughfare
			}
			if let locality = placemark.locality, !locality.isEmpty { place["locality"] = locality }
			if let subLocality = placemark.subLocality, !subLocality.isEmpty {
				place["subLocality"] = subLocality
			}
			if let administrativeArea = placemark.administrativeArea, !administrativeArea.isEmpty {
				place["administrativeArea"] = administrativeArea
			}
			if let subAdministrativeArea = placemark.subAdministrativeArea, !subAdministrativeArea.isEmpty {
				place["subAdministrativeArea"] = subAdministrativeArea
			}
			if let postalCode = placemark.postalCode, !postalCode.isEmpty {
				place["postalCode"] = postalCode
			}
			if let country = placemark.country, !country.isEmpty { place["country"] = country }
			if let iso = placemark.isoCountryCode, !iso.isEmpty { place["isoCountryCode"] = iso }
			if let timeZone = placemark.timeZone {
				place["timeZone"] = timeZone.identifier
			}

			let parts = [
				placemark.name,
				placemark.locality,
				placemark.administrativeArea,
				placemark.country,
			].compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
			if !parts.isEmpty {
				// Prefer a compact human label for the model.
				var unique: [String] = []
				for part in parts where !unique.contains(part) {
					unique.append(part)
				}
				place["displayName"] = unique.joined(separator: ", ")
			}

			return place.isEmpty ? nil : place
		} catch {
			return nil
		}
	}

	// MARK: - CLLocationManagerDelegate

	nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
		let status = manager.authorizationStatus
		Task { @MainActor in
			// Finish a pending auth prompt once the status leaves notDetermined.
			if status != .notDetermined, let continuation = authContinuation {
				authContinuation = nil
				continuation.resume(returning: status)
			}
		}
	}

	nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
		guard let location = locations.last else { return }
		Task { @MainActor in
			locationTimeoutTask?.cancel()
			locationTimeoutTask = nil
			if let continuation = locationContinuation {
				locationContinuation = nil
				continuation.resume(returning: location)
			}
		}
	}

	nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
		let clError = error as? CLError
		let needsPermission = clError?.code == .denied
		let message: String
		if needsPermission {
			message =
				"Location access denied. Enable Location Services for Toby in System Settings → Privacy & Security → Location Services."
		} else {
			message = error.localizedDescription
		}
		Task { @MainActor in
			locationTimeoutTask?.cancel()
			locationTimeoutTask = nil
			if let continuation = locationContinuation {
				locationContinuation = nil
				continuation.resume(
					throwing: LocationError(message: message, needsPermission: needsPermission)
				)
			}
		}
	}

	// MARK: - JSON helpers

	private func jsonInput(_ body: Data?) -> [String: Any]? {
		guard let body else { return [:] }
		return try? JSONSerialization.jsonObject(with: body) as? [String: Any]
	}

	private func stringValue(_ value: Any?) -> String? {
		if let s = value as? String { return s }
		if let n = value as? NSNumber { return n.stringValue }
		return nil
	}

	private func boolValue(_ value: Any?) -> Bool? {
		if let b = value as? Bool { return b }
		if let n = value as? NSNumber { return n.boolValue }
		if let s = value as? String {
			switch s.lowercased() {
			case "true", "1", "yes": return true
			case "false", "0", "no": return false
			default: return nil
			}
		}
		return nil
	}

	private func json(_ payload: [String: Any]) -> Data {
		guard JSONSerialization.isValidJSONObject(payload),
			let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
		else {
			return Data("{\"ok\":false,\"error\":\"encoding error\"}".utf8)
		}
		return data
	}
}

private struct LocationError: Error {
	let message: String
	let needsPermission: Bool
}
