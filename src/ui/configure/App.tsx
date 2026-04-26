import { Box, Text, render, useApp, useInput } from "ink";
import React, { useState, useCallback } from "react";
import type { SettingsItem } from "./items";

interface NavigatorProps {
	items: SettingsItem[];
	breadcrumb: string[];
	selectedIndex: number;
	statusMessage?: string;
	onSelect: (index: number) => void;
	onBack: () => void;
	onSelectItem: (item: SettingsItem) => void;
	onQuit: () => void;
}

function Navigator({
	items,
	breadcrumb,
	selectedIndex,
	statusMessage,
	onSelect,
	onBack,
	onSelectItem,
	onQuit,
}: NavigatorProps) {
	useInput((input, key) => {
		if (input === "q") {
			onQuit();
			return;
		}
		if (key.upArrow) {
			onSelect(Math.max(0, selectedIndex - 1));
			return;
		}
		if (key.downArrow) {
			onSelect(Math.min(items.length - 1, selectedIndex + 1));
			return;
		}
		if (key.return) {
			const item = items[selectedIndex];
			if (item) onSelectItem(item);
			return;
		}
		if (key.backspace || input === "b") {
			onBack();
		}
	});

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={1}>
				<Text bold color="cyan">
					{"  "}
					{breadcrumb.join(" > ")}
				</Text>
			</Box>
			{items.map((item, i) => {
				const selected = i === selectedIndex;
				let icon = " ";
				if (item.kind === "section") icon = "▸";
				else if (item.kind === "action") icon = "+";
				else if (item.kind === "delete") icon = "✕";
				return (
					<Box key={item.key} marginLeft={2}>
						<Text
							backgroundColor={selected ? "gray" : undefined}
							color={
								selected
									? "white"
									: item.kind === "action"
										? "yellow"
										: item.kind === "delete"
											? "red"
											: "green"
							}
							bold={selected}
						>
							{" "}
							{icon} {item.label}{" "}
						</Text>
						{item.kind === "value" && item.currentValue !== undefined ? (
							<Text dimColor>
								{item.masked
									? " ••••••"
									: item.multiline
										? ` ${item.currentValue.split("\n")[0]}${item.currentValue.includes("\n") ? " ..." : ""}`
										: ` ${item.currentValue}`}
							</Text>
						) : null}
						{item.kind === "select" && item.currentValue ? (
							<Text dimColor> {item.currentValue}</Text>
						) : null}
					</Box>
				);
			})}
			<Box marginTop={1} marginLeft={2} flexDirection="column">
				{statusMessage ? <Text color="yellow"> {statusMessage}</Text> : null}
				<Text dimColor>
					{" "}
					↑↓ navigate {"  "} ↵ select {"  "} b back {"  "} q quit
				</Text>
			</Box>
		</Box>
	);
}

interface EditorProps {
	item: SettingsItem;
	onSubmit: (value: string) => void;
	onCancel: () => void;
}

function Editor({ item, onSubmit, onCancel }: EditorProps) {
	const [value, setValue] = useState(item.currentValue ?? "");

	useInput((input, key) => {
		if (key.backspace || key.delete) {
			setValue((v) => v.slice(0, -1));
			return;
		}
		if (key.escape) {
			onCancel();
			return;
		}
		if (key.return) {
			onSubmit(value);
			return;
		}
		if (input && !key.ctrl && !key.meta) {
			setValue((v) => v + input);
		}
	});

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={1}>
				<Text bold color="cyan">
					{"  "}
					Edit: {item.label}
				</Text>
			</Box>
			<Box marginLeft={2}>
				<Text>
					{" "}
					{item.label}:{" "}
					<Text color="yellow">
						{item.masked ? "•".repeat(value.length) : value}
					</Text>
					<Text dimColor>_</Text>
				</Text>
			</Box>
			<Box marginTop={1} marginLeft={2}>
				<Text dimColor>
					{" "}
					type value {"  "} ↵ save {"  "} esc cancel
				</Text>
			</Box>
		</Box>
	);
}

interface MultilineEditorProps {
	item: SettingsItem;
	onSubmit: (value: string) => void;
	onCancel: () => void;
}

function MultilineEditor({ item, onSubmit, onCancel }: MultilineEditorProps) {
	const [lines, setLines] = useState(() => {
		const initial = item.currentValue ?? "";
		return initial === "" ? [""] : initial.split("\n");
	});
	const [cursorLine, setCursorLine] = useState(lines.length - 1);
	const maxVisibleLines = 8;
	const visibleLines = lines.slice(
		Math.max(0, cursorLine - maxVisibleLines + 1),
		cursorLine + 1,
	);

	useInput((input, key) => {
		if (key.ctrl && input === "s") {
			onSubmit(lines.join("\n"));
			return;
		}
		if (key.escape) {
			onCancel();
			return;
		}
		if (key.backspace || key.delete) {
			setLines((prev) => {
				const updated = [...prev];
				const currentLine = updated[cursorLine];
				if (currentLine.length > 0) {
					updated[cursorLine] = currentLine.slice(0, -1);
				} else if (cursorLine > 0) {
					updated[cursorLine - 1] = updated[cursorLine - 1] + currentLine;
					updated.splice(cursorLine, 1);
					setCursorLine(cursorLine - 1);
				}
				return updated;
			});
			return;
		}
		if (key.return) {
			setLines((prev) => {
				const updated = [...prev];
				const currentLine = updated[cursorLine];
				const before = currentLine.slice(0, currentLine.length);
				const after = "";
				updated[cursorLine] = before;
				updated.splice(cursorLine + 1, 0, after);
				return updated;
			});
			setCursorLine((c) => c + 1);
			return;
		}
		if (key.upArrow) {
			setCursorLine((c) => Math.max(0, c - 1));
			return;
		}
		if (key.downArrow) {
			setCursorLine((c) => Math.min(lines.length - 1, c + 1));
			return;
		}
		if (input && !key.ctrl && !key.meta) {
			setLines((prev) => {
				const updated = [...prev];
				updated[cursorLine] = updated[cursorLine] + input;
				return updated;
			});
		}
	});

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={1}>
				<Text bold color="cyan">
					{"  "}
					Edit: {item.label}
				</Text>
			</Box>
			<Box marginLeft={2} flexDirection="column">
				{visibleLines.map((line, i) => {
					const actualLineIndex = cursorLine - visibleLines.length + i + 1;
					const isCurrentLine = actualLineIndex === cursorLine;
					return (
						<Box key={`${actualLineIndex}`}>
							<Text dimColor>{isCurrentLine ? " ▸ " : "   "}</Text>
							<Text color="yellow">
								{line}
								{isCurrentLine ? <Text dimColor>_</Text> : ""}
							</Text>
						</Box>
					);
				})}
			</Box>
			<Box marginTop={1} marginLeft={2}>
				<Text dimColor>
					{" "}
					enter new line {"  "} ↑↓ navigate lines {"  "} ctrl+s save {"  "} esc
					cancel
				</Text>
			</Box>
		</Box>
	);
}

interface SelectorProps {
	item: SettingsItem;
	onSubmit: (value: string) => void;
	onCancel: () => void;
}

function Selector({ item, onSubmit, onCancel }: SelectorProps) {
	const options = item.options ?? [];
	const [sel, setSel] = useState(() => {
		const current = item.currentValue ?? "";
		const idx = options.indexOf(current);
		return idx >= 0 ? idx : 0;
	});

	useInput((input, key) => {
		if (key.escape) {
			onCancel();
			return;
		}
		if (key.return) {
			onSubmit(options[sel]);
			return;
		}
		if (key.upArrow || key.leftArrow) {
			setSel((s) => Math.max(0, s - 1));
			return;
		}
		if (key.downArrow || key.rightArrow) {
			setSel((s) => Math.min(options.length - 1, s + 1));
		}
	});

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={1}>
				<Text bold color="cyan">
					{"  "}
					Select: {item.label}
				</Text>
			</Box>
			{options.map((opt, i) => (
				<Box key={opt} marginLeft={2}>
					<Text
						backgroundColor={i === sel ? "gray" : undefined}
						color={i === sel ? "white" : "green"}
						bold={i === sel}
					>
						{" "}
						{i === sel ? "▸" : " "} {opt}{" "}
					</Text>
				</Box>
			))}
			<Box marginTop={1} marginLeft={2}>
				<Text dimColor>
					{" "}
					↑↓ choose {"  "} ↵ select {"  "} esc cancel
				</Text>
			</Box>
		</Box>
	);
}

interface ConfirmDialogProps {
	message: string;
	onConfirm: () => void;
	onCancel: () => void;
}

function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
	useInput((input, key) => {
		if (key.return || input === "y") {
			onConfirm();
			return;
		}
		if (key.escape || input === "n") {
			onCancel();
		}
	});

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={1}>
				<Text bold color="yellow">
					{"  "}
					{message}
				</Text>
			</Box>
			<Box marginLeft={2}>
				<Text dimColor> y confirm {"  "} n/esc cancel </Text>
			</Box>
		</Box>
	);
}

type Screen = "nav" | "edit" | "select" | "confirm";

interface AppCallbacks {
	onCreatePersona: () => string;
	onDeletePersona: (name: string) => void;
}

interface AppProps {
	root: SettingsItem;
	credentialValues: Record<string, string>;
	onSave: (values: Record<string, string>) => void;
	refreshTree: (values: Record<string, string>) => SettingsItem;
	callbacks: AppCallbacks;
}

function resolvePath(
	root: SettingsItem,
	keys: string[],
): {
	node: SettingsItem;
	resolvedPath: string[];
} {
	let node = root;
	const resolvedPath = [root.key];

	for (let i = 1; i < keys.length; i++) {
		const child = node.children?.find((c) => c.key === keys[i]);
		if (!child) {
			break;
		}
		node = child;
		resolvedPath.push(keys[i]);
	}

	return { node, resolvedPath };
}

function App({
	root,
	credentialValues,
	onSave,
	refreshTree,
	callbacks,
}: AppProps) {
	const { exit } = useApp();
	const [tree, setTree] = useState(root);
	const [screen, setScreen] = useState<Screen>("nav");
	const [path, setPath] = useState<string[]>(["root"]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [editItem, setEditItem] = useState<SettingsItem | null>(null);
	const [values, setValues] =
		useState<Record<string, string>>(credentialValues);
	const [confirmMsg, setConfirmMsg] = useState("");
	const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);
	const [statusMessage, setStatusMessage] = useState<string | undefined>(
		undefined,
	);

	const { node: currentNode, resolvedPath } = resolvePath(tree, path);
	const items = (currentNode.children ?? []).map((item) => ({
		...item,
		currentValue:
			item.kind === "value" || item.kind === "select"
				? (values[item.key] ?? item.currentValue)
				: undefined,
	}));

	const breadcrumb = resolvedPath
		.map((_, index) => {
			const node = resolvePath(tree, resolvedPath.slice(0, index + 1)).node;
			return node.label;
		})
		.filter(Boolean);

	const doRefresh = useCallback(
		(newValues: Record<string, string>) => {
			const newTree = refreshTree(newValues);
			setTree(newTree);
			setPath((prevPath) => resolvePath(newTree, prevPath).resolvedPath);
			setSelectedIndex(0);
		},
		[refreshTree],
	);

	const handleQuit = useCallback(() => {
		onSave(values);
		exit();
	}, [values, onSave, exit]);

	const handleBack = useCallback(() => {
		if (path.length > 1) {
			setPath((p) => p.slice(0, -1));
			setSelectedIndex(0);
		}
		setStatusMessage(undefined);
	}, [path]);

	const handleSelectItem = useCallback(
		(item: SettingsItem) => {
			setStatusMessage(undefined);
			if (item.kind === "section") {
				setPath((p) => {
					const nextPath = [...p, item.key];
					const resolvedNextPath = resolvePath(tree, nextPath).resolvedPath;
					if (resolvedNextPath.length !== nextPath.length) {
						return p;
					}
					setSelectedIndex(0);
					return nextPath;
				});
			} else if (item.kind === "value") {
				setEditItem(item);
				setScreen("edit");
			} else if (item.kind === "select") {
				setEditItem(item);
				setScreen("select");
			} else if (item.kind === "action") {
				if (item.key === "personas._new") {
					const personaName = callbacks.onCreatePersona();
					const newValues = {
						...values,
						[`personas.${personaName}.name`]: personaName,
						[`personas.${personaName}.instructions`]: "",
						[`personas.${personaName}.promptMode`]: "add",
						[`personas.${personaName}.ai.provider`]: "openai",
						[`personas.${personaName}.ai.model`]: "gpt-5-mini",
					};
					setValues(newValues);
					doRefresh(newValues);
				}
			} else if (item.kind === "delete") {
				const personaName = item.key
					.replace("personas.", "")
					.replace("._delete", "");
				setConfirmMsg(`Delete persona "${personaName}"?`);
				setConfirmAction(() => () => {
					callbacks.onDeletePersona(personaName);
					const cleanedValues: Record<string, string> = {};
					const deletedPrefix = `personas.${personaName}.`;
					for (const [key, value] of Object.entries(values)) {
						if (!key.startsWith(deletedPrefix)) {
							cleanedValues[key] = value;
						}
					}
					setValues(cleanedValues);
					doRefresh(cleanedValues);
					setPath((p) => p.slice(0, -1));
					setSelectedIndex(0);
					setScreen("nav");
				});
				setScreen("confirm");
			}
		},
		[values, doRefresh, callbacks, tree],
	);

	const handleEditorSubmit = useCallback(
		(newValue: string) => {
			if (editItem) {
				let newValues = { ...values, [editItem.key]: newValue };
				const personaNameKeyMatch = /^personas\.(.+)\.name$/.exec(editItem.key);

				if (personaNameKeyMatch) {
					const oldName = personaNameKeyMatch[1];
					const newName = newValue;
					if (newName && newName !== oldName) {
						const existingNames = new Set(
							Object.keys(values)
								.filter(
									(key) => key.startsWith("personas.") && key.endsWith(".name"),
								)
								.map((key) => values[key]),
						);
						existingNames.delete(oldName);

						if (existingNames.has(newName)) {
							setStatusMessage(
								`Persona "${newName}" already exists. Choose a different name.`,
							);
							setScreen("nav");
							setEditItem(null);
							return;
						}

						const oldPrefix = `personas.${oldName}.`;
						const migratedValues: Record<string, string> = {
							...newValues,
						};

						for (const [key, value] of Object.entries(newValues)) {
							if (!key.startsWith(oldPrefix)) {
								continue;
							}
							const suffix = key.slice(oldPrefix.length);
							delete migratedValues[key];
							migratedValues[`personas.${newName}.${suffix}`] = value;
						}

						migratedValues[`personas.${newName}.name`] = newName;
						newValues = migratedValues;
					}
				}

				setValues(newValues);
				doRefresh(newValues);
			}
			setStatusMessage(undefined);
			setScreen("nav");
			setEditItem(null);
		},
		[editItem, values, doRefresh],
	);

	const handleSelectSubmit = useCallback(
		(newValue: string) => {
			if (editItem) {
				const newValues = { ...values, [editItem.key]: newValue };
				setValues(newValues);
				doRefresh(newValues);
			}
			setScreen("nav");
			setEditItem(null);
		},
		[editItem, values, doRefresh],
	);

	const handleEditorCancel = useCallback(() => {
		setScreen("nav");
		setEditItem(null);
	}, []);

	if (screen === "confirm" && confirmAction) {
		return (
			<ConfirmDialog
				message={confirmMsg}
				onConfirm={() => {
					confirmAction();
					setConfirmAction(null);
					setConfirmMsg("");
				}}
				onCancel={() => {
					setConfirmAction(null);
					setConfirmMsg("");
					setScreen("nav");
				}}
			/>
		);
	}

	if (screen === "edit" && editItem) {
		const resolvedValue = values[editItem.key] ?? editItem.currentValue;
		const itemWithCurrent = { ...editItem, currentValue: resolvedValue };

		if (editItem.multiline) {
			return (
				<MultilineEditor
					item={itemWithCurrent}
					onSubmit={handleEditorSubmit}
					onCancel={handleEditorCancel}
				/>
			);
		}
		return (
			<Editor
				item={itemWithCurrent}
				onSubmit={handleEditorSubmit}
				onCancel={handleEditorCancel}
			/>
		);
	}

	if (screen === "select" && editItem) {
		return (
			<Selector
				item={{
					...editItem,
					currentValue: values[editItem.key] ?? editItem.currentValue,
				}}
				onSubmit={handleSelectSubmit}
				onCancel={handleEditorCancel}
			/>
		);
	}

	return (
		<Navigator
			items={items}
			breadcrumb={breadcrumb}
			selectedIndex={selectedIndex}
			statusMessage={statusMessage}
			onSelect={setSelectedIndex}
			onBack={handleBack}
			onSelectItem={handleSelectItem}
			onQuit={handleQuit}
		/>
	);
}

export function runConfigureUI(
	root: SettingsItem,
	credentialValues: Record<string, string>,
	onSave: (values: Record<string, string>) => void,
	refreshTree: (values: Record<string, string>) => SettingsItem,
	callbacks: {
		onCreatePersona: () => string;
		onDeletePersona: (name: string) => void;
	},
): void {
	render(
		<App
			root={root}
			credentialValues={credentialValues}
			onSave={onSave}
			refreshTree={refreshTree}
			callbacks={callbacks}
		/>,
	);
}
