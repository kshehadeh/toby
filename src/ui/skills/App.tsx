import { Box, Text, render, useApp, useInput } from "ink";
import { useCallback, useState } from "react";
import { getSkillsDir } from "../../config/index";
import { type LocalSkill, loadLocalSkills } from "../../skills/index";
import { deleteSkill, openSkillInEditor } from "../../skills/manage";
import { ACCENT } from "../chat/constants";
import {
	ActionRow,
	ConfirmDialog,
	NavigatorRow,
	SelectableTextRow,
	UI_GLYPHS,
	UI_HINTS,
	ViewFrame,
	detectTerminalProfile,
	isBackKey,
	isNavigateDown,
	isNavigateUp,
	isQuitKey,
	isSelectKey,
	resolveKittyKeyboardMode,
} from "../shared";
import type { FieldNavigatorItem } from "../shared";

const MAX_DESC_PREVIEW = 60;
const MAX_BODY_PREVIEW = 200;

function truncatePreview(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
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
		if (isQuitKey(input, key)) {
			onQuit();
			return;
		}
		if (isNavigateUp(input, key)) {
			onSelect(Math.max(0, selectedIndex - 1));
			return;
		}
		if (isNavigateDown(input, key)) {
			onSelect(Math.min(skills.length - 1, selectedIndex + 1));
			return;
		}
		if (isSelectKey(input, key) && skills[selectedIndex]) {
			onSelectSkill(skills[selectedIndex]);
		}
	});

	if (skills.length === 0) {
		return (
			<ViewFrame title="Skills" footer={<Text dimColor>q close</Text>}>
				<Box paddingX={1} paddingY={1}>
					<Text dimColor>
						No skills found. Add skills to{" "}
						<Text color={ACCENT}>{getSkillsDir()}</Text>
					</Text>
				</Box>
			</ViewFrame>
		);
	}

	return (
		<ViewFrame title="Skills" footer={<Text dimColor>{UI_HINTS.list}</Text>}>
			{skills.map((skill, i) => {
				const selected = i === selectedIndex;
				const desc = truncatePreview(skill.description, MAX_DESC_PREVIEW);
				return (
					<SelectableTextRow key={skill.dirName} selected={selected}>
						{UI_GLYPHS.section} {skill.name} <Text dimColor>{desc}</Text>
					</SelectableTextRow>
				);
			})}
		</ViewFrame>
	);
}

type SkillBrowseItem =
	| FieldNavigatorItem
	| { key: string; kind: "action"; label: string; actionKey: "edit" }
	| { key: string; kind: "delete"; label: string };

interface SkillBrowseProps {
	skill: LocalSkill;
	items: SkillBrowseItem[];
	selectedIndex: number;
	statusMessage?: string;
	onSelect: (index: number) => void;
	onSelectItem: (item: SkillBrowseItem) => void;
	onBack: () => void;
	onQuit: () => void;
}

function SkillBrowse({
	skill,
	items,
	selectedIndex,
	statusMessage,
	onSelect,
	onSelectItem,
	onBack,
	onQuit,
}: SkillBrowseProps) {
	useInput((input, key) => {
		if (isQuitKey(input, key)) {
			onQuit();
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

	const bodyPreview = truncatePreview(skill.bodyMarkdown, MAX_BODY_PREVIEW);

	return (
		<ViewFrame title="Skills" footer={<Text dimColor>{UI_HINTS.detail}</Text>}>
			<Box marginBottom={1} paddingX={1}>
				<Text bold color={ACCENT}>
					Skills &gt; {skill.name}
				</Text>
			</Box>
			{items.map((item, i) => {
				const selected = i === selectedIndex;
				if (item.kind === "action" || item.kind === "delete") {
					return (
						<ActionRow
							key={item.key}
							label={item.label}
							selected={selected}
							kind={item.kind}
						/>
					);
				}
				const rowKind = item.kind === "info" ? ("value" as const) : item.kind;
				return (
					<NavigatorRow
						key={item.key}
						label={item.label}
						kind={rowKind}
						selected={selected}
						multiline={item.multiline}
						currentValue={item.currentValue}
					/>
				);
			})}
			<Box marginTop={1} paddingX={1}>
				<Text dimColor italic wrap="truncate-end">
					{bodyPreview}
				</Text>
			</Box>
			{statusMessage ? (
				<Box marginTop={1} paddingX={1}>
					<Text color="yellow">{statusMessage}</Text>
				</Box>
			) : null}
		</ViewFrame>
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

	const detailItems: SkillBrowseItem[] = selectedSkill
		? [
				{
					key: "name",
					label: "Name",
					kind: "info",
					currentValue: selectedSkill.name,
				},
				{
					key: "description",
					label: "Description",
					kind: "info",
					currentValue: selectedSkill.description,
					multiline: true,
				},
				{
					key: "file",
					label: "File",
					kind: "info",
					currentValue: `${getSkillsDir()}/${selectedSkill.dirName}/SKILL.md`,
				},
				{
					key: "edit",
					kind: "action",
					label: "Edit in editor",
					actionKey: "edit",
				},
				{
					key: "delete",
					kind: "delete",
					label: "Delete skill",
				},
			]
		: [];

	const handleDetailItem = useCallback(
		(item: SkillBrowseItem) => {
			if (
				"actionKey" in item &&
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
			if (item.kind === "delete" && selectedSkill) {
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
				title="Skills"
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
			<SkillBrowse
				skill={selectedSkill}
				items={detailItems}
				selectedIndex={selectedDetailIndex}
				statusMessage={statusMessage}
				onSelect={setSelectedDetailIndex}
				onSelectItem={handleDetailItem}
				onBack={handleBack}
				onQuit={handleQuit}
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
