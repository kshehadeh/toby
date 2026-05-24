import { Box, Text, useInput } from "ink";
import type React from "react";
import { ACCENT } from "../chat/constants";
import {
	isBackKey,
	isNavigateDown,
	isNavigateUp,
	isSaveKey,
	isSelectKey,
} from "./keybindings";
import { NavigatorRow } from "./rows";
import type { NavigatorRowProps } from "./rows";
import { ViewFrame } from "./view-frame";

export type FieldNavigatorItemKind = NavigatorRowProps["kind"] | "info";

export interface FieldNavigatorItem {
	/** Unique row id for React keys. */
	readonly key: string;
	readonly label: string;
	readonly kind: FieldNavigatorItemKind;
	readonly currentValue?: string;
	readonly masked?: boolean;
	readonly multiline?: boolean;
	readonly options?: string[];
}

export interface FieldNavigatorProps {
	readonly appTitle: string;
	readonly breadcrumb: string[];
	readonly items: FieldNavigatorItem[];
	readonly selectedIndex: number;
	readonly statusMessage?: string;
	readonly footer: React.ReactNode;
	readonly onSelect: (index: number) => void;
	readonly onBack: () => void;
	readonly onSelectItem: (item: FieldNavigatorItem) => void;
	readonly onSave?: () => void;
	readonly extraInput?: (input: string, key: import("ink").Key) => boolean;
}

export function FieldNavigator({
	appTitle,
	breadcrumb,
	items,
	selectedIndex,
	statusMessage,
	footer,
	onSelect,
	onBack,
	onSelectItem,
	onSave,
	extraInput,
}: FieldNavigatorProps) {
	useInput((input, key) => {
		if (extraInput?.(input, key)) {
			return;
		}
		if (onSave && isSaveKey(input, key)) {
			onSave();
			return;
		}
		if (isNavigateUp(input, key)) {
			onSelect(Math.max(0, selectedIndex - 1));
			return;
		}
		if (isNavigateDown(input, key)) {
			onSelect(Math.min(items.length - 1, selectedIndex + 1));
			return;
		}
		if (isSelectKey(input, key)) {
			const item = items[selectedIndex];
			if (item) {
				onSelectItem(item);
			}
			return;
		}
		if (isBackKey(input, key)) {
			onBack();
		}
	});

	return (
		<ViewFrame title={appTitle} footer={footer}>
			<Box marginBottom={1} paddingX={1}>
				<Text bold color={ACCENT}>
					{breadcrumb.join(" > ")}
				</Text>
			</Box>
			{items.map((item, i) => {
				const selected = i === selectedIndex;
				const rowKind = item.kind === "info" ? ("value" as const) : item.kind;
				return (
					<NavigatorRow
						key={item.key}
						label={item.label}
						kind={rowKind}
						selected={selected}
						masked={item.masked}
						multiline={item.multiline}
						currentValue={item.currentValue}
						options={item.options}
					/>
				);
			})}
			<Box marginTop={1} paddingX={1} flexDirection="column">
				{statusMessage ? <Text color="yellow">{statusMessage}</Text> : null}
			</Box>
		</ViewFrame>
	);
}
