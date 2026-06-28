export class ListenTranscriptionError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "ListenTranscriptionError";
		this.code = code;
	}
}
