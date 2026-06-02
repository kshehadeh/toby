import { getTobyVersion } from "@toby/core/version";
import { Box, Text } from "ink";
import type React from "react";
import { ACCENT, INPUT_BORDER } from "../chat/constants";
import { useTerminalLayout } from "./use-terminal-layout";

const TOBY_VERSION = getTobyVersion();

export interface ViewFrameProps {
	readonly title: string;
	readonly children: React.ReactNode;
	readonly footer?: React.ReactNode;
	readonly subheader?: React.ReactNode;
	/** When set, replaces the footer (e.g. a confirmation overlay). */
	readonly overlay?: React.ReactNode;
}

/**
 * Compact full-width title bar shown at the top of non-chat full-screen views,
 * reading `Toby — <View> — v<version>`. Shared by {@link ViewFrame} and the
 * two-pane layout so the header is rendered identically in both.
 */
export function ViewHeader({ title }: { readonly title: string }) {
	return (
		<Box
			flexShrink={0}
			borderStyle="single"
			borderColor={INPUT_BORDER}
			paddingX={1}
			justifyContent="center"
		>
			<Text wrap="truncate-end">
				<Text bold color={ACCENT}>
					Toby
				</Text>
				<Text dimColor> — </Text>
				<Text bold>{title}</Text>
				<Text dimColor> — v{TOBY_VERSION}</Text>
			</Text>
		</Box>
	);
}

export function ViewFrame({
	title,
	children,
	footer,
	subheader,
	overlay,
}: ViewFrameProps) {
	const { termCols, frameHeight } = useTerminalLayout();

	return (
		<Box
			flexDirection="column"
			padding={1}
			width={termCols}
			height={frameHeight}
		>
			<ViewHeader title={title} />
			{subheader ? <Box justifyContent="center">{subheader}</Box> : null}
			<Box
				borderStyle="single"
				borderColor={INPUT_BORDER}
				flexDirection="column"
			>
				{children}
			</Box>
			{overlay ? (
				<Box flexShrink={0} marginTop={1}>
					{overlay}
				</Box>
			) : footer ? (
				<Box paddingX={1}>{footer}</Box>
			) : null}
		</Box>
	);
}
