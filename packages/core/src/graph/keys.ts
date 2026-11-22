/** Stable node keys, so the same person or thread from two sources is one node. */

export function normalizeEmail(address: string): string {
	return address.trim().toLowerCase();
}

/** Pull the address out of `Name <a@b.com>`; returns null when there is none. */
export function emailFromAddressLine(line: string): string | null {
	const angle = /<([^<>\s]+@[^<>\s]+)>/.exec(line);
	const raw = angle?.[1] ?? /[^\s<>,;"]+@[^\s<>,;"]+/.exec(line)?.[0];
	return raw ? normalizeEmail(raw) : null;
}

export function emailPersonKey(address: string): string {
	return `email:${normalizeEmail(address)}`;
}

export function slackPersonKey(userId: string, teamId?: string): string {
	return teamId ? `slack:${teamId}:${userId}` : `slack:${userId}`;
}

export function threadKey(sourceId: string, threadId: string): string {
	return `${sourceId}:${threadId}`;
}

/** Key for model-extracted entities (project, org, topic): case- and space-insensitive. */
export function entityNameKey(name: string): string {
	return `name:${name.trim().toLowerCase().replace(/\s+/g, " ")}`;
}
