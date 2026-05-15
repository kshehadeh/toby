import { Box, Text, render, useApp, useInput } from "ink";
import type React from "react";
import { useCallback, useState } from "react";
import { getSkillsDir } from "../../config/index";
import { type LocalSkill, loadLocalSkills } from "../../skills/index";
import { deleteSkill, openSkillInEditor } from "../../skills/manage";
import { AppHeader } from "../chat/components/app-header";
import { ACCENT, INPUT_BORDER } from "../chat/constants";
import { detectTerminalProfile, resolveKittyKeyboardMode } from "../shared";

const MAX_DESC_PREVIEW = 60;
const MAX_BODY_PREVIEW = 200;

function SkillsFrame({
	title,
	children,
	footer,
}: {
	readonly title: string;
	readonly children: React.ReactNode;
	readonly footer?: React.ReactNode;
}) {
	return (
		<Box flexDirection="column" padding={1}>
			<AppHeader
				subheader={
					<Text color={ACCENT} bold wrap="truncate-end">
						{title}
					</Text>
				}
			/>
			<Box
				marginTop={1}
				borderStyle="single"
				borderColor={INPUT_BORDER}
				flexDirection="column"
			>
				{children}
			</Box>
			{footer ? (
				<Box marginTop={1} paddingX={1}>
					{footer}
				</Box>
			) : null}
		</Box>
	);
}

interface SkillListProps {
	skills: LocalSkill[];
	selectedIndex: number;
	onSelect: (index: number) => void;
	onSelectSkill: (skill: LocalSkill) => void;
	onQuit: () => void;
}

function SkillList({
	skills,
	selectedIndex,
	onSelect,
	onSelectSkill,
	onQuit,
}: SkillListProps) {
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
			onSelect(Math.min(skills.length - 1, selectedIndex + 1));
			return;
		}
		if (key.return && skills[selectedIndex]) {
			onSelectSkill(skills[selectedIndex]);
		}
	});

	if (skills.length === 0) {
		return (
			<SkillsFrame title="Skills" footer={<Text dimColor>q close</Text>}>
				<Box paddingX={1} paddingY={1}>
					<Text dimColor>
						No skills found. Add skills to{" "}
						<Text color={ACCENT}>{getSkillsDir()}</Text>
					</Text>
				</Box>
			</SkillsFrame>
		);
	}

	return (
		<SkillsFrame
			title="Skills"
			footer={<Text dimColor>↑↓ navigate · Enter select · q close</Text>}
		>
			{skills.map((skill, i) => {
				const selected = i === selectedIndex;
				const desc =
					skill.description.length > MAX_DESC_PREVIEW
						? `${skill.description.slice(0, MAX_DESC_PREVIEW - 1)}…`
						: skill.description;
				return (
					<Box key={skill.dirName} paddingX={1}>
						<Text wrap="truncate-end">
							<Text color={selected ? ACCENT : "gray"} bold>
								{selected ? "› " : "  "}
							</Text>
							<Text color={selected ? "white" : "green"} bold={selected}>
								▸ {skill.name}{" "}
							</Text>
							<Text dimColor>{desc}</Text>
						</Text>
					</Box>
				);
			})}
		</SkillsFrame>
	);
}

type DetailItem =
	| { kind: "info"; label: string; value: string }
	| { kind: "action"; label: string; actionKey: string }
	| { kind: "delete"; label: string; actionKey: string };

interface SkillDetailProps {
	skill: LocalSkill;
	selectedIndex: number;
	onSelect: (index: number) => void;
	onSelectItem: (item: DetailItem) => void;
	onBack: () => void;
	statusMessage?: string;
}

function SkillDetail({
	skill,
	selectedIndex,
	onSelect,
	onSelectItem,
	onBack,
	statusMessage,
}: SkillDetailProps) {
	const items: DetailItem[] = [
		{ kind: "info", label: "Name", value: skill.name },
		{
			kind: "info",
			label: "Description",
			value: skill.description,
		},
		{
			kind: "info",
			label: "File",
			value: `${getSkillsDir()}/${skill.dirName}/SKILL.md`,
		},
		{ kind: "action", label: "Edit in editor", actionKey: "edit" },
		{ kind: "delete", label: "Delete skill", actionKey: "delete" },
	];

	useInput((input, key) => {
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
		<SkillsFrame
			title={`Skills > ${skill.name}`}
			footer={
				<Text dimColor>↑↓ navigate · Enter select · b back · q close</Text>
			}
		>
			{items.map((item, i) => {
				const selected = i === selectedIndex;
				if (item.kind === "info") {
					return (
						<Box key={item.label} paddingX={1} flexDirection="column">
							<Text bold color={selected ? ACCENT : undefined}>
								{selected ? "› " : "  "}
								{item.label}
							</Text>
							<Text dimColor wrap="truncate-end">
								{"  "}
								{item.value}
							</Text>
						</Box>
					);
				}
				const icon = item.kind === "action" ? "+" : "✕";
				const color = item.kind === "action" ? "yellow" : "red";
				return (
					<Box key={item.actionKey} paddingX={1}>
						<Text>
							<Text color={selected ? ACCENT : "gray"} bold>
								{selected ? "› " : "  "}
							</Text>
							<Text color={selected ? "white" : color} bold={selected}>
								{icon} {item.label}
							</Text>
						</Text>
					</Box>
				);
			})}
			<Box marginTop={1} paddingX={1}>
				<Text dimColor italic wrap="truncate-end">
					{skill.bodyMarkdown.length > MAX_BODY_PREVIEW
						? `${skill.bodyMarkdown.slice(0, MAX_BODY_PREVIEW - 1)}…`
						: skill.bodyMarkdown}
				</Text>
			</Box>
			{statusMessage ? (
				<Box marginTop={1} paddingX={1}>
					<Text color="yellow">{statusMessage}</Text>
				</Box>
			) : null}
		</SkillsFrame>
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
		<SkillsFrame
			title="Skills"
			footer={<Text dimColor>y/Enter confirm · n/Esc cancel</Text>}
		>
			<Box paddingX={1}>
				<Text bold color="yellow">
					{message}
				</Text>
			</Box>
		</SkillsFrame>
	);
}

type Screen = "list" | "detail" | "confirm";

interface SkillsAppProps {
	onQuitRequested?: () => void;
}

export function SkillsApp({ onQuitRequested }: SkillsAppProps) {
	const { exit } = useApp();
	const [skills, setSkills] = useState<LocalSkill[]>(() => loadLocalSkills());
	const [screen, setScreen] = useState<Screen>("list");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [selectedDetailIndex, setSelectedDetailIndex] = useState(0);
	const [selectedSkill, setSelectedSkill] = useState<LocalSkill | null>(null);
	const [confirmMsg, setConfirmMsg] = useState("");
	const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);
	const [statusMessage, setStatusMessage] = useState<string | undefined>(
		undefined,
	);

	const refreshSkills = useCallback(() => {
		setSkills(loadLocalSkills());
	}, []);

	const handleQuit = useCallback(() => {
		if (onQuitRequested) {
			onQuitRequested();
			return;
		}
		exit();
	}, [onQuitRequested, exit]);

	const handleSelectSkill = useCallback((skill: LocalSkill) => {
		setSelectedSkill(skill);
		setSelectedDetailIndex(0);
		setScreen("detail");
		setStatusMessage(undefined);
	}, []);

	const handleBack = useCallback(() => {
		setScreen("list");
		setSelectedSkill(null);
		setStatusMessage(undefined);
	}, []);

	const handleDetailItem = useCallback(
		(item: DetailItem) => {
			if (
				item.kind === "action" &&
				item.actionKey === "edit" &&
				selectedSkill
			) {
				try {
					openSkillInEditor(selectedSkill.dirName);
					setStatusMessage("Opened in editor.");
				} catch (e) {
					setStatusMessage(
						e instanceof Error ? e.message : "Failed to open editor.",
					);
				}
				return;
			}
			if (
				item.kind === "delete" &&
				item.actionKey === "delete" &&
				selectedSkill
			) {
				setConfirmMsg(`Delete skill "${selectedSkill.name}"?`);
				setConfirmAction(() => () => {
					try {
						deleteSkill(selectedSkill.dirName);
						refreshSkills();
						setScreen("list");
						setSelectedSkill(null);
						setSelectedIndex(0);
					} catch (e) {
						setStatusMessage(
							e instanceof Error ? e.message : "Failed to delete skill.",
						);
					}
					setConfirmAction(null);
					setConfirmMsg("");
				});
				setScreen("confirm");
			}
		},
		[selectedSkill, refreshSkills],
	);

	if (screen === "confirm" && confirmAction) {
		return (
			<ConfirmDialog
				message={confirmMsg}
				onConfirm={() => {
					confirmAction();
				}}
				onCancel={() => {
					setConfirmAction(null);
					setConfirmMsg("");
					setScreen("detail");
				}}
			/>
		);
	}

	if (screen === "detail" && selectedSkill) {
		return (
			<SkillDetail
				skill={selectedSkill}
				selectedIndex={selectedDetailIndex}
				onSelect={setSelectedDetailIndex}
				onSelectItem={handleDetailItem}
				onBack={handleBack}
				statusMessage={statusMessage}
			/>
		);
	}

	return (
		<SkillList
			skills={skills}
			selectedIndex={selectedIndex}
			onSelect={setSelectedIndex}
			onSelectSkill={handleSelectSkill}
			onQuit={handleQuit}
		/>
	);
}

export function runSkillsUI(): void {
	const profile = detectTerminalProfile();
	render(<SkillsApp />, {
		kittyKeyboard: {
			mode: resolveKittyKeyboardMode(profile),
			flags: ["disambiguateEscapeCodes"],
		},
	});
}
