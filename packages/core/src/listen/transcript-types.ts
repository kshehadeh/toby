export interface TranscriptSegment {
	readonly text: string;
	readonly timestamp: number;
	readonly duration: number;
	readonly confidence: number;
	readonly alternatives: readonly string[];
}

export interface TranscriptPayload {
	readonly text: string;
	readonly segments: readonly TranscriptSegment[];
	readonly sourceAudio: string;
	readonly createdAt: string;
	readonly locale: string;
}
