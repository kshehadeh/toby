import Foundation
import WhisperBridge

enum WhisperInference {
	static func transcribeWav(
		modelPath: String,
		wavPath: String,
		language: String
	) throws -> WhisperJsonPayload {
		var errorPointer: UnsafeMutablePointer<CChar>?
		let jsonPointer: UnsafeMutablePointer<CChar>? = modelPath.withCString { modelCString in
			wavPath.withCString { wavCString in
				language.withCString { languageCString in
					whisper_bridge_transcribe_wav_json(
						modelCString,
						wavCString,
						languageCString,
						&errorPointer
					)
				}
			}
		}

		if let errorPointer {
			let message = String(cString: errorPointer)
			whisper_bridge_free_string(errorPointer)
			throw TranscriptionError.runtime(message)
		}

		guard let jsonPointer else {
			throw TranscriptionError.runtime("Whisper transcription returned no output")
		}
		defer { whisper_bridge_free_string(jsonPointer) }

		let jsonData = Data(bytes: jsonPointer, count: strlen(jsonPointer))
		do {
			return try JSONDecoder().decode(WhisperJsonPayload.self, from: jsonData)
		} catch {
			throw TranscriptionError.runtime("Could not decode whisper output: \(error.localizedDescription)")
		}
	}
}
