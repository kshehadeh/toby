interface ReconcileCursorIndexParams {
	readonly currentCursorIndex: number;
	readonly nextInputLength: number;
	readonly forceResetToEnd: boolean;
}

export function reconcileCursorIndex({
	currentCursorIndex,
	nextInputLength,
	forceResetToEnd,
}: ReconcileCursorIndexParams): number {
	if (forceResetToEnd) {
		return nextInputLength;
	}
	return Math.min(currentCursorIndex, nextInputLength);
}
