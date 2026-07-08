import Contacts
import Foundation

@MainActor
enum NativeContactsHandler {
	private static let store = CNContactStore()

	private static let contactKeys: [CNKeyDescriptor] = [
		CNContactIdentifierKey as NSString,
		CNContactFormatter.descriptorForRequiredKeys(for: .fullName),
		CNContactNamePrefixKey as NSString,
		CNContactGivenNameKey as NSString,
		CNContactMiddleNameKey as NSString,
		CNContactFamilyNameKey as NSString,
		CNContactPreviousFamilyNameKey as NSString,
		CNContactNameSuffixKey as NSString,
		CNContactNicknameKey as NSString,
		CNContactOrganizationNameKey as NSString,
		CNContactDepartmentNameKey as NSString,
		CNContactJobTitleKey as NSString,
		CNContactEmailAddressesKey as NSString,
		CNContactPhoneNumbersKey as NSString,
		CNContactPostalAddressesKey as NSString,
		CNContactUrlAddressesKey as NSString,
		CNContactBirthdayKey as NSString,
		CNContactDatesKey as NSString,
		CNContactRelationsKey as NSString,
		CNContactSocialProfilesKey as NSString,
		CNContactInstantMessageAddressesKey as NSString,
	]

	// MARK: - Access

	static func requestAccess() async -> Data {
		let granted = await ensureAccessAsync()
		if granted {
			return json(["ok": true, "data": ["prompted": true, "granted": true]])
		}
		return json([
			"ok": false,
			"error": "Contacts access denied.",
			"needsPermission": true,
			"data": ["prompted": true, "granted": false],
		])
	}

	// MARK: - Search contacts

	static func searchContacts(body: Data?) async -> Data {
		guard await ensureAccessAsync() else {
			return json(["ok": false, "error": "Contacts access denied.", "needsPermission": true])
		}

		let input = jsonInput(body) ?? [:]
		let query = stringValue(input["query"])?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		let limit = min(max(intValue(input["limit"]) ?? 25, 1), 100)
		let needle = query.lowercased()

		var contacts: [[String: Any]] = []
		let request = CNContactFetchRequest(keysToFetch: contactKeys)
		request.sortOrder = .userDefault

		do {
			try store.enumerateContacts(with: request) { contact, stop in
				if needle.isEmpty || matches(contact, needle: needle) {
					contacts.append(summaryDict(contact))
				}
				if contacts.count >= limit {
					stop.pointee = true
				}
			}
			return json(["ok": true, "data": ["contacts": contacts, "count": contacts.count]])
		} catch {
			return json(["ok": false, "error": error.localizedDescription])
		}
	}

	// MARK: - Get contact

	static func getContact(body: Data?) async -> Data {
		guard await ensureAccessAsync() else {
			return json(["ok": false, "error": "Contacts access denied.", "needsPermission": true])
		}
		guard let input = jsonInput(body),
			let identifier = stringValue(input["identifier"])?.trimmingCharacters(in: .whitespacesAndNewlines),
			!identifier.isEmpty
		else {
			return json(["ok": false, "error": "identifier is required."])
		}

		do {
			let contact = try store.unifiedContact(withIdentifier: identifier, keysToFetch: contactKeys)
			return json(["ok": true, "data": detailDict(contact)])
		} catch {
			return json(["ok": false, "error": "Contact not found. Verify the identifier."])
		}
	}

	// MARK: - Helpers

	private static func ensureAccessAsync() async -> Bool {
		if CNContactStore.authorizationStatus(for: .contacts) == .authorized {
			return true
		}
		return await withCheckedContinuation { continuation in
			store.requestAccess(for: .contacts) { @Sendable granted, _ in
				continuation.resume(returning: granted)
			}
		}
	}

	private static func summaryDict(_ contact: CNContact) -> [String: Any] {
		[
			"identifier": contact.identifier,
			"displayName": displayName(contact),
			"givenName": contact.givenName,
			"familyName": contact.familyName,
			"organizationName": contact.organizationName,
			"jobTitle": contact.jobTitle,
			"emailAddresses": contact.emailAddresses.map { $0.value as String },
			"phoneNumbers": contact.phoneNumbers.map { $0.value.stringValue },
		]
	}

	private static func detailDict(_ contact: CNContact) -> [String: Any] {
		var dict = summaryDict(contact)
		dict["namePrefix"] = contact.namePrefix
		dict["middleName"] = contact.middleName
		dict["previousFamilyName"] = contact.previousFamilyName
		dict["nameSuffix"] = contact.nameSuffix
		dict["nickname"] = contact.nickname
		dict["departmentName"] = contact.departmentName
		dict["emailAddresses"] = labeledStrings(contact.emailAddresses)
		dict["phoneNumbers"] = contact.phoneNumbers.map { labeledValue($0.label, $0.value.stringValue) }
		dict["postalAddresses"] = contact.postalAddresses.map { postalAddressDict($0) }
		dict["urlAddresses"] = labeledStrings(contact.urlAddresses)
		if let birthday = dateComponentsDict(contact.birthday) {
			dict["birthday"] = birthday
		}
		dict["dates"] = contact.dates.map { labeledValue($0.label, dateComponentsDict($0.value) as Any) }
		dict["relations"] = contact.contactRelations.map { labeledValue($0.label, $0.value.name) }
		dict["socialProfiles"] = contact.socialProfiles.map { socialProfileDict($0) }
		dict["instantMessageAddresses"] = contact.instantMessageAddresses.map { instantMessageDict($0) }
		return dict
	}

	private static func displayName(_ contact: CNContact) -> String {
		if let name = CNContactFormatter.string(from: contact, style: .fullName),
			!name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
		{
			return name
		}
		if !contact.organizationName.isEmpty { return contact.organizationName }
		return [contact.givenName, contact.familyName].filter { !$0.isEmpty }.joined(separator: " ")
	}

	private static func matches(_ contact: CNContact, needle: String) -> Bool {
		for value in searchableStrings(contact) {
			if value.lowercased().contains(needle) {
				return true
			}
		}
		return false
	}

	private static func searchableStrings(_ contact: CNContact) -> [String] {
		var values = [
			displayName(contact),
			contact.givenName,
			contact.middleName,
			contact.familyName,
			contact.nickname,
			contact.organizationName,
			contact.departmentName,
			contact.jobTitle,
		]
		values.append(contentsOf: contact.emailAddresses.map { $0.value as String })
		values.append(contentsOf: contact.phoneNumbers.map { $0.value.stringValue })
		values.append(contentsOf: contact.urlAddresses.map { $0.value as String })
		values.append(contentsOf: contact.postalAddresses.flatMap { addressSearchStrings($0.value) })
		return values.filter { !$0.isEmpty }
	}

	private static func labeledStrings<T>(_ values: [CNLabeledValue<T>]) -> [[String: Any]] where T: NSString {
		values.map { labeledValue($0.label, $0.value as String) }
	}

	private static func labeledValue(_ label: String?, _ value: Any) -> [String: Any] {
		[
			"label": localizedLabel(label),
			"value": value,
		]
	}

	private static func localizedLabel(_ label: String?) -> String {
		guard let label, !label.isEmpty else { return "" }
		return CNLabeledValue<NSString>.localizedString(forLabel: label)
	}

	private static func postalAddressDict(_ value: CNLabeledValue<CNPostalAddress>) -> [String: Any] {
		let address = value.value
		return [
			"label": localizedLabel(value.label),
			"street": address.street,
			"city": address.city,
			"state": address.state,
			"postalCode": address.postalCode,
			"country": address.country,
			"countryCode": address.isoCountryCode,
			"formatted": CNPostalAddressFormatter.string(from: address, style: .mailingAddress),
		]
	}

	private static func socialProfileDict(_ value: CNLabeledValue<CNSocialProfile>) -> [String: Any] {
		let profile = value.value
		return [
			"label": localizedLabel(value.label),
			"service": profile.service,
			"username": profile.username,
			"userIdentifier": profile.userIdentifier,
			"urlString": profile.urlString,
		]
	}

	private static func instantMessageDict(_ value: CNLabeledValue<CNInstantMessageAddress>) -> [String: Any] {
		let address = value.value
		return [
			"label": localizedLabel(value.label),
			"service": address.service,
			"username": address.username,
		]
	}

	private static func addressSearchStrings(_ address: CNPostalAddress) -> [String] {
		[
			address.street,
			address.city,
			address.state,
			address.postalCode,
			address.country,
			address.isoCountryCode,
		]
	}

	private static func dateComponentsDict(_ components: DateComponents?) -> [String: Any]? {
		guard let components else { return nil }
		var dict: [String: Any] = [:]
		if let year = components.year { dict["year"] = year }
		if let month = components.month { dict["month"] = month }
		if let day = components.day { dict["day"] = day }
		if let hour = components.hour { dict["hour"] = hour }
		if let minute = components.minute { dict["minute"] = minute }
		if let second = components.second { dict["second"] = second }
		return dict
	}

	private static func dateComponentsDict(_ components: NSDateComponents?) -> [String: Any]? {
		guard let components else { return nil }
		return dateComponentsDict(components as DateComponents)
	}

	private static func jsonInput(_ body: Data?) -> [String: Any]? {
		guard let body else { return [:] }
		return try? JSONSerialization.jsonObject(with: body) as? [String: Any]
	}

	private static func stringValue(_ value: Any?) -> String? {
		if let s = value as? String { return s }
		if let n = value as? NSNumber { return n.stringValue }
		return nil
	}

	private static func intValue(_ value: Any?) -> Int? {
		if let n = value as? Int { return n }
		if let d = value as? Double { return Int(d) }
		if let n = value as? NSNumber { return n.intValue }
		return nil
	}

	private static func json(_ payload: [String: Any]) -> Data {
		guard JSONSerialization.isValidJSONObject(payload),
			let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
		else {
			return Data("{\"ok\":false,\"error\":\"encoding error\"}".utf8)
		}
		return data
	}
}
