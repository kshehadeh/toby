import { Text } from "ink";

export interface DaemonStatusLineProps {
	readonly daemonRunning: boolean;
	readonly trailingText?: string | null;
}

export function DaemonStatusLine({
	daemonRunning,
	trailingText = null,
}: DaemonStatusLineProps) {
	return (
		<Text dimColor wrap="truncate-start">
			{"Daemon "}
			{daemonRunning ? <Text color="green">✔︎</Text> : <Text color="red">✗</Text>}
			{trailingText ? ` · ${trailingText}` : ""}
		</Text>
	);
}
