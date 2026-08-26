import Testing
@testable import TobyApp

@Suite("Reverse-geocoded place dictionary")
struct NativeLocationPlaceTests {
	@Test("maps city, region, and country into the documented place fields")
	func mapsDocumentedPlaceFields() {
		let place = reverseGeocodedPlaceDictionary(
			name: "Ferry Building",
			timeZoneIdentifier: "America/Los_Angeles",
			cityName: "San Francisco",
			cityWithContext: "San Francisco, CA",
			cityWithFullContext: "San Francisco, CA, United States",
			regionName: "United States",
			isoCountryCode: "US",
			fullAddress: "1 Ferry Building\nSan Francisco, CA 94111\nUnited States",
			shortAddress: "1 Ferry Building",
		)

		#expect(place?["name"] as? String == "Ferry Building")
		#expect(place?["locality"] as? String == "San Francisco")
		#expect(place?["administrativeArea"] as? String == "CA")
		#expect(place?["country"] as? String == "United States")
		#expect(place?["isoCountryCode"] as? String == "US")
		#expect(place?["timeZone"] as? String == "America/Los_Angeles")
		#expect(place?["displayName"] as? String == "San Francisco, CA, United States")
		#expect(place?["fullAddress"] as? String == "1 Ferry Building\nSan Francisco, CA 94111\nUnited States")
		#expect(place?["shortAddress"] as? String == "1 Ferry Building")
	}

	@Test("does not treat country as an administrative area")
	func skipsCountryAsAdministrativeArea() {
		let place = reverseGeocodedPlaceDictionary(
			name: nil,
			timeZoneIdentifier: nil,
			cityName: "Paris",
			cityWithContext: "Paris, France",
			cityWithFullContext: "Paris, France",
			regionName: "France",
			isoCountryCode: "FR",
			fullAddress: nil,
			shortAddress: nil,
		)

		#expect(place?["locality"] as? String == "Paris")
		#expect(place?["administrativeArea"] as? String == nil)
		#expect(place?["country"] as? String == "France")
		#expect(place?["displayName"] as? String == "Paris, France")
	}

	@Test("falls back to a compact display name when MapKit context is missing")
	func compactDisplayNameFallback() {
		let place = reverseGeocodedPlaceDictionary(
			name: "Home",
			timeZoneIdentifier: nil,
			cityName: "Austin",
			cityWithContext: nil,
			cityWithFullContext: nil,
			regionName: "United States",
			isoCountryCode: "US",
			fullAddress: nil,
			shortAddress: nil,
		)

		#expect(place?["displayName"] as? String == "Home, Austin, United States")
	}

	@Test("returns nil when every field is empty")
	func emptyPlaceIsNil() {
		let place = reverseGeocodedPlaceDictionary(
			name: "  ",
			timeZoneIdentifier: nil,
			cityName: nil,
			cityWithContext: nil,
			cityWithFullContext: nil,
			regionName: nil,
			isoCountryCode: nil,
			fullAddress: "",
			shortAddress: nil,
		)
		#expect(place == nil)
	}
}
