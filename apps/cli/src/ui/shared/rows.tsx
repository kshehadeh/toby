import { Box, Text } from "ink";
import type React from "react";
import { ACCENT } from "../chat/constants";
import { STATUS_GLYPHS, UI_GLYPHS } from "./glyphs";

export function selectedPrefix(selected: boolean): string {
	return selected ? UI_GLYPHS.cursor : UI_GLYPHS.spacer;
}

export interface SelectableTextRowProps {
	readonly children: React.ReactNode;
	readonly selected: boolean;
	readonly color?: string;
	readonly selectedColor?: string;
	readonly dim?: boolean;
}

export function SelectableTextRow({
	children,
	selected,
	color,
	selectedColor = "white",
	dim = false,
}: SelectableTextRowProps) {
	return (
		<Box paddingX={1}>
			<Text wrap="truncate-end">
				<Text color={selected ? ACCENT : "gray"} bold>
					{selectedPrefix(selected)}
				</Text>
				<Text
					color={selected ? selectedColor : color}
					bold={selected}
					dimColor={dim && !selected}
				>
					{children}
				</Text>
			</Text>
		</Box>
	);
}

interface InfoRowProps {
	readonly label: string;
	readonly value: string;
	readonly selected: boolean;
	readonly multiline?: boolean;
	readonly hint?: string;
}

function InfoRow({
	label,
	value,
	selected,
	multiline = false,
	hint,
}: InfoRowProps) {
	if (multiline) {
		return (
			<Box paddingX={1} flexDirection="column">
				<Text bold color={selected ? ACCENT : undefined}>
					{selectedPrefix(selected)}
					{label}
					{hint ? (
						<Text dimColor italic>
							{hint}
						</Text>
					) : null}
				</Text>
				<Text dimColor wrap="truncate-end">
					{"    "}
					{value}
				</Text>
			</Box>
		);
	}

	return (
		<Box paddingX={1} flexDirection="row">
			<Text bold color={selected ? ACCENT : undefined}>
				{selectedPrefix(selected)}
				{label}
				{hint ? (
					<Text dimColor italic>
						{hint}
					</Text>
				) : null}
			</Text>
			<Text dimColor wrap="truncate-end">
				{": "}
				{value}
			</Text>
		</Box>
	);
}

export interface ActionRowProps {
	readonly label: string;
	readonly selected: boolean;
	readonly kind?: "action" | "delete" | "section";
}

export function ActionRow({
	label,
	selected,
	kind = "action",
}: ActionRowProps) {
	const icon =
		kind === "delete"
			? UI_GLYPHS.delete
			: kind === "section"
				? UI_GLYPHS.section
				: UI_GLYPHS.action;
	const color =
		kind === "delete" ? "red" : kind === "section" ? "green" : "yellow";

	return (
		<SelectableTextRow selected={selected} color={color}>
			{icon} {label}
		</SelectableTextRow>
	);
}

export interface StatusIconProps {
	readonly status: keyof typeof STATUS_GLYPHS;
}

export function StatusIcon({ status }: StatusIconProps) {
	const { glyph, color } = STATUS_GLYPHS[status];
	return <Text color={color}>{glyph}</Text>;
}

export interface NavigatorRowProps {
	readonly label: string;
	readonly kind: "section" | "value" | "action" | "delete" | "select";
	readonly selected: boolean;
	readonly masked?: boolean;
	readonly multiline?: boolean;
	readonly currentValue?: string;
	readonly options?: string[];
}

export function NavigatorRow({
	label,
	kind,
	selected,
	masked = false,
	multiline = false,
	currentValue,
}: NavigatorRowProps) {
	const icon =
		kind === "delete"
			? UI_GLYPHS.delete
			: kind === "section"
				? UI_GLYPHS.section
				: kind === "action"
					? UI_GLYPHS.action
					: " ";
	const color =
		kind === "delete"
			? "red"
			: kind === "section"
				? "green"
				: kind === "action"
					? "yellow"
					: "green";

	return (
		<Box paddingX={1} flexDirection="row">
			<Box flexShrink={0}>
				<Text wrap="truncate-end">
					<Text color={selected ? ACCENT : "gray"} bold>
						{selectedPrefix(selected)}
					</Text>
					<Text color={selected ? "white" : color} bold={selected}>
						{icon} {label}{" "}
					</Text>
				</Text>
			</Box>
			{kind === "value" && currentValue !== undefined ? (
				<Box flexShrink={1}>
					<Text dimColor wrap="truncate-end">
						{masked
							? " ••••••"
							: multiline
								? ` ${currentValue.split("\n")[0]}${currentValue.includes("\n") ? " ..." : ""}`
								: ` ${currentValue}`}
					</Text>
				</Box>
			) : null}
			{kind === "select" && currentValue ? (
				<Box flexShrink={1}>
					<Text dimColor wrap="truncate-end">
						{" "}
						{currentValue}
					</Text>
				</Box>
			) : null}
		</Box>
	);
}

export interface SectionDividerProps {
	readonly label: string;
}

export function SectionDivider({ label }: SectionDividerProps) {
	return (
		<Box paddingX={1} marginTop={1}>
			<Text bold color={ACCENT}>
				─── {label} ───
			</Text>
		</Box>
	);
}
