import { Box, Text, render, useApp, useInput, useStdout } from "ink";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listPersonas } from "../../personas/index";
import {
	cronToHuman,
	humanToCronAsync,
	isValidCronExpression,
} from "../../schedules/cron";
import { isDaemonRunning } from "../../schedules/daemon-status";
import { executeSchedule } from "../../schedules/executor";
import {
	createSchedule,
	deleteSchedule as deleteScheduleFromStore,
	listScheduleRuns,
	listSchedules,
	updateSchedule,
} from "../../schedules/store";
import type {
	CreateScheduleParams,
	Schedule,
	ScheduleRun,
} from "../../schedules/types";
import { ACCENT } from "../chat/constants";
import {
	ActionRow,
	ConfirmDialog,
	DaemonStatusLine,
	FieldEditor,
	FieldSelector,
	NavigatorRow,
	SectionDivider,
	SelectableTextRow,
	StatusIcon,
	UI_GLYPHS,
	UI_HINTS,
	ViewFrame,
	detectTerminalProfile,
	isBackKey,
	isNavigateDown,
	isNavigateUp,
	isSaveKey,
	isSelectKey,
	resolveKittyKeyboardMode,
	selectedPrefix,
} from "../shared";
import type { FieldNavigatorItem } from "../shared";

const MAX_PROMPT_PREVIEW = 60;
const MAX_OUTPUT_PREVIEW = 80;

type Screen = "list" | "schedule" | "edit" | "select" | "confirm" | "runOutput";

type EditField = "name" | "prompt" | "persona" | "cron";
type SelectField = "enabled" | "persona";

function schedulesSubheader(
	daemonRunning: boolean,
	activeScheduleCount: number,
) {
	const activeLabel = `${activeScheduleCount} active schedule${
		activeScheduleCount === 1 ? "" : "s"
	}`;
	return (
		<Box flexDirection="column" alignItems="center">
			<Text bold color={ACCENT} wrap="truncate-end">
				Schedules
			</Text>
			<DaemonStatusLine
				daemonRunning={daemonRunning}
				trailingText={activeLabel}
			/>
		</Box>
	);
}

interface ScheduleFormState {
	name: string;
	prompt: string;
	personaName: string;
	cronExpression: string;
	enabled: boolean;
}

const DEFAULT_FORM: ScheduleFormState = {
	name: "",
	prompt: "",
	personaName: "Toby",
	cronExpression: "0 9 * * *",
	enabled: true,
};

type ScheduleBrowseItem =
	| (FieldNavigatorItem & { browseKind: "field" })
	| { key: string; browseKind: "action"; label: string; actionKey: "run" }
	| { key: string; browseKind: "delete"; label: string }
	| { key: string; browseKind: "divider"; label: string }
	| { key: string; browseKind: "run"; run: ScheduleRun };

function truncatePreview(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

interface ScheduleListProps {
	schedules: Schedule[];
	selectedIndex: number;
	daemonRunning: boolean;
	activeScheduleCount: number;
	onSelect: (index: number) => void;
	onSelectSchedule: (schedule: Schedule) => void;
	onCreate: () => void;
	onBack: () => void;
}

function ScheduleList({
	schedules,
	selectedIndex,
	daemonRunning,
	activeScheduleCount,
	onSelect,
	onSelectSchedule,
	onCreate,
	onBack,
}: ScheduleListProps) {
	useInput((input, key) => {
		if (isBackKey(input, key)) {
			onBack();
			return;
		}
		if (input === "c" || input === "n") {
			onCreate();
			return;
		}
		if (isNavigateUp(input, key)) {
			onSelect(Math.max(0, selectedIndex - 1));
			return;
		}
		if (isNavigateDown(input, key)) {
			onSelect(Math.min(schedules.length - 1, selectedIndex + 1));
			return;
		}
		if (isSelectKey(input, key) && schedules[selectedIndex]) {
			onSelectSchedule(schedules[selectedIndex]);
		}
	});

	if (schedules.length === 0) {
		return (
			<ViewFrame
				title="Schedules"
				subheader={schedulesSubheader(daemonRunning, activeScheduleCount)}
				footer={<Text dimColor>c create · Esc close</Text>}
			>
				<Box paddingX={1} paddingY={1}>
					<Text dimColor>No schedules yet. Press </Text>
					<Text color={ACCENT} bold>
						c
					</Text>
					<Text dimColor> to create one.</Text>
				</Box>
			</ViewFrame>
		);
	}

	return (
		<ViewFrame
			title="Schedules"
			subheader={schedulesSubheader(daemonRunning, activeScheduleCount)}
			footer={<Text dimColor>{UI_HINTS.list} · c create</Text>}
		>
			{schedules.map((schedule, i) => {
				const selected = i === selectedIndex;
				const humanCron = cronToHuman(schedule.cronExpression);
				const promptPreview = truncatePreview(
					schedule.prompt,
					MAX_PROMPT_PREVIEW,
				);
				return (
					<SelectableTextRow key={schedule.id} selected={selected}>
						<StatusIcon status={schedule.enabled ? "enabled" : "disabled"} />
						{UI_GLYPHS.section} {schedule.name}{" "}
						<Text dimColor>
							{humanCron} · <Text italic>{promptPreview}</Text>
						</Text>
					</SelectableTextRow>
				);
			})}
		</ViewFrame>
	);
}

interface ScheduleBrowseProps {
	title: string;
	breadcrumb: string[];
	items: ScheduleBrowseItem[];
	selectedIndex: number;
	daemonRunning: boolean;
	activeScheduleCount: number;
	statusMessage?: string;
	saving: boolean;
	running: boolean;
	onSelect: (index: number) => void;
	onSelectItem: (item: ScheduleBrowseItem) => void;
	onSave: () => void;
	onBack: () => void;
}

function ScheduleBrowse({
	title,
	breadcrumb,
	items,
	selectedIndex,
	daemonRunning,
	activeScheduleCount,
	statusMessage,
	saving,
	running,
	onSelect,
	onSelectItem,
	onSave,
	onBack,
}: ScheduleBrowseProps) {
	useInput((input, key) => {
		if (saving || running) {
			return;
		}
		if (isSaveKey(input, key)) {
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
		<ViewFrame
			title={title}
			subheader={schedulesSubheader(daemonRunning, activeScheduleCount)}
			footer={<Text dimColor>{UI_HINTS.fieldBrowse}</Text>}
		>
			<Box marginBottom={1} paddingX={1}>
				<Text bold color={ACCENT}>
					{breadcrumb.join(" > ")}
				</Text>
			</Box>
			{items.map((item, i) => {
				const selected = i === selectedIndex;
				if (item.browseKind === "field") {
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
				}
				if (item.browseKind === "divider") {
					return <SectionDivider key={item.key} label={item.label} />;
				}
				if (item.browseKind === "run") {
					return (
						<Box key={item.key} paddingX={1}>
							<Text wrap="truncate-end">
								<Text color={selected ? ACCENT : "gray"} bold>
									{selectedPrefix(selected)}
								</Text>
								<StatusIcon status={item.run.status} />
								<Text dimColor>
									{" "}
									{new Date(item.run.startedAt).toLocaleString()}
								</Text>
							</Text>
						</Box>
					);
				}
				return (
					<ActionRow
						key={item.key}
						label={item.label}
						selected={selected}
						kind={item.browseKind === "delete" ? "delete" : "action"}
					/>
				);
			})}
			<Box marginTop={1} paddingX={1} flexDirection="column">
				{statusMessage ? <Text color="yellow">{statusMessage}</Text> : null}
			</Box>
		</ViewFrame>
	);
}

interface RunOutputViewProps {
	run: ScheduleRun;
	scheduleName: string;
	onBack: () => void;
}

function RunOutputView({ run, scheduleName, onBack }: RunOutputViewProps) {
	const [scrollOffset, setScrollOffset] = useState(0);
	const { stdout } = useStdout();

	const rawOutput = run.output ?? "(no output)";
	const lines = rawOutput.split("\n");
	const totalLines = lines.length;

	const chromeRows = 11;
	const terminalRows = stdout?.rows ?? 24;
	const visibleLines = Math.max(3, terminalRows - chromeRows);
	const maxOffset = Math.max(0, totalLines - visibleLines);

	const visible = lines.slice(scrollOffset, scrollOffset + visibleLines);

	useInput((input, key) => {
		if (key.escape) {
			onBack();
			return;
		}
		if (isNavigateDown(input, key)) {
			setScrollOffset((o) => Math.min(o + 1, maxOffset));
			return;
		}
		if (isNavigateUp(input, key)) {
			setScrollOffset((o) => Math.max(o - 1, 0));
			return;
		}
		if (key.pageDown || input === " ") {
			setScrollOffset((o) => Math.min(o + visibleLines, maxOffset));
			return;
		}
		if (key.pageUp) {
			setScrollOffset((o) => Math.max(o - visibleLines, 0));
			return;
		}
		if (input === "g") {
			setScrollOffset(0);
			return;
		}
		if (input === "G") {
			setScrollOffset(maxOffset);
		}
	});

	const scrollIndicator =
		totalLines > visibleLines
			? ` [${scrollOffset + 1}-${Math.min(scrollOffset + visibleLines, totalLines)}/${totalLines}]`
			: "";

	return (
		<ViewFrame
			title={`Schedules > ${scheduleName} > Run ${new Date(run.startedAt).toLocaleString()}`}
			footer={
				<Text dimColor>
					↑↓ scroll · Space/PageDn · PageUp · g/G top/bottom · Esc back
				</Text>
			}
		>
			<Box paddingX={1} flexDirection="column">
				<Text>
					<StatusIcon status={run.status} />
					<Text dimColor>
						{" "}
						{run.status.toUpperCase()} ·{" "}
						{new Date(run.startedAt).toLocaleString()}
						{run.completedAt
							? ` → ${new Date(run.completedAt).toLocaleString()}`
							: ""}
					</Text>
				</Text>
				{run.error ? <Text color="red">{run.error}</Text> : null}
			</Box>
			<SectionDivider label={`Output${scrollIndicator}`} />
			<Box paddingX={1} flexDirection="column">
				{visible.map((line, i) => (
					<Text key={`line-${run.id}-${scrollOffset + i}`}>{line}</Text>
				))}
			</Box>
		</ViewFrame>
	);
}

function buildScheduleBrowseItems(
	form: ScheduleFormState,
	runs: ScheduleRun[],
	lastRunAt: string | undefined,
	isCreating: boolean,
	running: boolean,
): ScheduleBrowseItem[] {
	const promptPreview = form.prompt
		? truncatePreview(form.prompt, MAX_PROMPT_PREVIEW)
		: "(empty)";

	const fields: ScheduleBrowseItem[] = [
		{
			browseKind: "field",
			key: "name",
			label: "Name",
			kind: "value",
			currentValue: form.name || "(empty)",
		},
		{
			browseKind: "field",
			key: "prompt",
			label: "Prompt",
			kind: "value",
			currentValue: promptPreview,
			multiline: true,
		},
		{
			browseKind: "field",
			key: "persona",
			label: "Persona",
			kind: "select",
			currentValue: form.personaName,
		},
		{
			browseKind: "field",
			key: "cron",
			label: "Schedule",
			kind: "value",
			currentValue: `${form.cronExpression} (${cronToHuman(form.cronExpression)})`,
		},
		{
			browseKind: "field",
			key: "enabled",
			label: "Enabled",
			kind: "select",
			currentValue: form.enabled ? "Yes" : "No",
		},
	];

	if (!isCreating) {
		fields.push({
			browseKind: "field",
			key: "lastRun",
			label: "Last run",
			kind: "info",
			currentValue: lastRunAt ? new Date(lastRunAt).toLocaleString() : "Never",
		});
		fields.push({
			browseKind: "action",
			key: "run",
			label: running ? "Running…" : "Run now",
			actionKey: "run",
		});
		fields.push({
			browseKind: "delete",
			key: "delete",
			label: "Delete schedule",
		});
	}

	if (runs.length > 0 && !isCreating) {
		return [
			...fields,
			{ browseKind: "divider", key: "runs-divider", label: "Recent runs" },
			...runs.map((run) => ({
				browseKind: "run" as const,
				key: `run-${run.id}`,
				run,
			})),
		];
	}

	return fields;
}

interface SchedulesAppProps {
	onQuitRequested?: () => void;
}

export function SchedulesApp({ onQuitRequested }: SchedulesAppProps) {
	const { exit } = useApp();
	const [schedules, setSchedules] = useState<Schedule[]>(() => listSchedules());
	const [screen, setScreen] = useState<Screen>("list");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [browseIndex, setBrowseIndex] = useState(0);
	const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(
		null,
	);
	const [runs, setRuns] = useState<ScheduleRun[]>([]);
	const [confirmMsg, setConfirmMsg] = useState("");
	const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);
	const [statusMessage, setStatusMessage] = useState<string | undefined>(
		undefined,
	);
	const [editField, setEditField] = useState<EditField | null>(null);
	const [selectField, setSelectField] = useState<SelectField | null>(null);
	const [form, setForm] = useState<ScheduleFormState>(DEFAULT_FORM);
	const [isCreating, setIsCreating] = useState(false);
	const [saving, setSaving] = useState(false);
	const [running, setRunning] = useState(false);
	const [selectedRun, setSelectedRun] = useState<ScheduleRun | null>(null);
	const [daemonRunning, setDaemonRunning] = useState(
		() => isDaemonRunning().running,
	);
	const activeScheduleCount = useMemo(
		() => schedules.filter((schedule) => schedule.enabled).length,
		[schedules],
	);

	const personas = listPersonas();
	const personaNames = useMemo(() => personas.map((p) => p.name), [personas]);

	useEffect(() => {
		const timer = setInterval(() => {
			setDaemonRunning(isDaemonRunning().running);
		}, 10_000);
		return () => clearInterval(timer);
	}, []);

	const refreshSchedules = useCallback(() => {
		setSchedules(listSchedules());
	}, []);

	const handleQuit = useCallback(() => {
		if (onQuitRequested) {
			onQuitRequested();
			return;
		}
		exit();
	}, [onQuitRequested, exit]);

	const isFormDirty = useCallback((): boolean => {
		if (isCreating) {
			return (
				form.name !== DEFAULT_FORM.name ||
				form.prompt !== DEFAULT_FORM.prompt ||
				form.personaName !== DEFAULT_FORM.personaName ||
				form.cronExpression !== DEFAULT_FORM.cronExpression ||
				form.enabled !== DEFAULT_FORM.enabled
			);
		}
		if (selectedSchedule) {
			return (
				form.name !== selectedSchedule.name ||
				form.prompt !== selectedSchedule.prompt ||
				form.personaName !== selectedSchedule.personaName ||
				form.cronExpression !== selectedSchedule.cronExpression ||
				form.enabled !== selectedSchedule.enabled
			);
		}
		return false;
	}, [isCreating, form, selectedSchedule]);

	const openSchedule = useCallback((schedule: Schedule) => {
		setSelectedSchedule(schedule);
		setIsCreating(false);
		setForm({
			name: schedule.name,
			prompt: schedule.prompt,
			personaName: schedule.personaName,
			cronExpression: schedule.cronExpression,
			enabled: schedule.enabled,
		});
		setRuns(listScheduleRuns(schedule.id, 3));
		setBrowseIndex(0);
		setScreen("schedule");
		setStatusMessage(undefined);
		setEditField(null);
		setSelectField(null);
	}, []);

	const handleCreate = useCallback(() => {
		setIsCreating(true);
		setSelectedSchedule(null);
		setForm(DEFAULT_FORM);
		setRuns([]);
		setBrowseIndex(0);
		setScreen("schedule");
		setStatusMessage(undefined);
		setEditField(null);
		setSelectField(null);
	}, []);

	const handleBack = useCallback(() => {
		if (screen === "runOutput") {
			setScreen("schedule");
			setSelectedRun(null);
			return;
		}
		if (editField || selectField) {
			setEditField(null);
			setSelectField(null);
			return;
		}
		if (screen === "schedule") {
			if (isFormDirty()) {
				setConfirmMsg("Discard unsaved changes?");
				setConfirmAction(() => () => {
					setConfirmAction(null);
					setConfirmMsg("");
					setScreen("list");
					setSelectedSchedule(null);
					setIsCreating(false);
					setStatusMessage(undefined);
				});
				setScreen("confirm");
				return;
			}
			setScreen("list");
			setSelectedSchedule(null);
			setIsCreating(false);
			setStatusMessage(undefined);
		}
	}, [screen, editField, selectField, isFormDirty]);

	const handleListBack = useCallback(() => {
		handleQuit();
	}, [handleQuit]);

	const handleSave = useCallback(async () => {
		if (saving) {
			return;
		}
		if (!form.name.trim()) {
			setStatusMessage("Name is required.");
			return;
		}
		if (!form.prompt.trim()) {
			setStatusMessage("Prompt is required.");
			return;
		}
		try {
			setSaving(true);
			setStatusMessage("Converting schedule expression…");
			const cronExpr = await humanToCronAsync(form.cronExpression);
			if (!isValidCronExpression(cronExpr)) {
				setSaving(false);
				setStatusMessage("Invalid cron expression.");
				return;
			}

			if (isCreating) {
				const params: CreateScheduleParams = {
					name: form.name.trim(),
					prompt: form.prompt.trim(),
					personaName: form.personaName,
					cronExpression: cronExpr,
					enabled: form.enabled,
				};
				createSchedule(params);
				refreshSchedules();
				setScreen("list");
				setStatusMessage(undefined);
				setSaving(false);
				return;
			}

			if (selectedSchedule) {
				updateSchedule(selectedSchedule.id, {
					name: form.name.trim(),
					prompt: form.prompt.trim(),
					personaName: form.personaName,
					cronExpression: cronExpr,
					enabled: form.enabled,
				});
				refreshSchedules();
				const updated = listSchedules().find(
					(s) => s.id === selectedSchedule.id,
				);
				if (updated) {
					setSelectedSchedule(updated);
					setRuns(listScheduleRuns(updated.id, 3));
					setForm({
						name: updated.name,
						prompt: updated.prompt,
						personaName: updated.personaName,
						cronExpression: updated.cronExpression,
						enabled: updated.enabled,
					});
				}
				setStatusMessage("Schedule saved.");
			}
			setSaving(false);
		} catch (e) {
			setSaving(false);
			setStatusMessage(e instanceof Error ? e.message : "Failed to save.");
		}
	}, [form, isCreating, selectedSchedule, refreshSchedules, saving]);

	const handleFieldEditSubmit = useCallback(
		async (value: string) => {
			if (!editField) {
				return;
			}

			if (editField === "cron") {
				try {
					setStatusMessage("Converting schedule expression…");
					const cronExpr = await humanToCronAsync(value);
					setForm((f) => ({ ...f, cronExpression: cronExpr }));
					setStatusMessage(undefined);
				} catch {
					setStatusMessage(
						'Invalid schedule expression. Try a cron format like "0 9 * * *" or natural language like "every weekday at 9am".',
					);
				}
			} else if (editField === "name") {
				setForm((f) => ({ ...f, name: value }));
			} else if (editField === "prompt") {
				setForm((f) => ({ ...f, prompt: value }));
				if (!isCreating && selectedSchedule) {
					const updated = updateSchedule(selectedSchedule.id, {
						prompt: value,
					});
					if (updated) {
						refreshSchedules();
						setSelectedSchedule(updated);
						setRuns(listScheduleRuns(updated.id, 3));
						setForm({
							name: updated.name,
							prompt: updated.prompt,
							personaName: updated.personaName,
							cronExpression: updated.cronExpression,
							enabled: updated.enabled,
						});
						setStatusMessage("Prompt saved.");
					} else {
						setStatusMessage("Failed to save prompt.");
					}
				}
			}
			setEditField(null);
			setScreen("schedule");
		},
		[editField, isCreating, refreshSchedules, selectedSchedule],
	);

	const handleSelectSubmit = useCallback(
		(value: string) => {
			if (selectField === "enabled") {
				setForm((f) => ({
					...f,
					enabled: value === "Yes",
				}));
			} else if (selectField === "persona") {
				setForm((f) => ({ ...f, personaName: value }));
			}
			setSelectField(null);
			setScreen("schedule");
		},
		[selectField],
	);

	const handleRunNow = useCallback(async () => {
		if (!selectedSchedule || running || isCreating) {
			return;
		}
		setRunning(true);
		setStatusMessage("Running schedule…");
		try {
			await executeSchedule(selectedSchedule);
			refreshSchedules();
			const updated = listSchedules().find((s) => s.id === selectedSchedule.id);
			if (updated) {
				setSelectedSchedule(updated);
				setRuns(listScheduleRuns(updated.id, 3));
			}
			setStatusMessage(undefined);
		} catch (e) {
			setStatusMessage(
				`Run failed: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
		setRunning(false);
	}, [selectedSchedule, running, isCreating, refreshSchedules]);

	const browseItems = buildScheduleBrowseItems(
		form,
		runs,
		selectedSchedule?.lastRunAt ?? undefined,
		isCreating,
		running,
	);

	const breadcrumb = isCreating
		? ["Schedules", "New"]
		: ["Schedules", form.name || selectedSchedule?.name || ""];

	const handleBrowseItem = useCallback(
		(item: ScheduleBrowseItem) => {
			if (item.browseKind === "field") {
				if (item.key === "lastRun") {
					return;
				}
				if (item.key === "enabled" || item.key === "persona") {
					setSelectField(item.key === "enabled" ? "enabled" : "persona");
					setScreen("select");
					return;
				}
				if (
					item.key === "name" ||
					item.key === "prompt" ||
					item.key === "cron"
				) {
					setEditField(item.key);
					setScreen("edit");
				}
				return;
			}
			if (item.browseKind === "action" && item.actionKey === "run") {
				handleRunNow();
				return;
			}
			if (item.browseKind === "delete") {
				if (!selectedSchedule) {
					return;
				}
				setConfirmMsg(`Delete schedule "${selectedSchedule.name}"?`);
				setConfirmAction(() => () => {
					deleteScheduleFromStore(selectedSchedule.id);
					refreshSchedules();
					setScreen("list");
					setSelectedSchedule(null);
					setSelectedIndex(0);
					setConfirmAction(null);
					setConfirmMsg("");
				});
				setScreen("confirm");
				return;
			}
			if (item.browseKind === "run") {
				setSelectedRun(item.run);
				setScreen("runOutput");
			}
		},
		[handleRunNow, refreshSchedules, selectedSchedule],
	);

	if (screen === "confirm" && confirmAction) {
		return (
			<ConfirmDialog
				title="Schedules"
				message={confirmMsg}
				onConfirm={() => {
					confirmAction();
				}}
				onCancel={() => {
					setConfirmAction(null);
					setConfirmMsg("");
					setScreen("schedule");
				}}
			/>
		);
	}

	if (screen === "runOutput" && selectedRun && selectedSchedule) {
		return (
			<RunOutputView
				run={selectedRun}
				scheduleName={selectedSchedule.name}
				onBack={handleBack}
			/>
		);
	}

	if (screen === "edit" && editField) {
		const editValues: Record<
			EditField,
			{ value: string; multiline?: boolean }
		> = {
			name: { value: form.name },
			prompt: { value: form.prompt, multiline: true },
			persona: { value: form.personaName },
			cron: { value: form.cronExpression },
		};
		const labels: Record<EditField, string> = {
			name: "Name",
			prompt: "Prompt",
			persona: "Persona",
			cron: "Schedule",
		};
		const current = editValues[editField];
		return (
			<FieldEditor
				appTitle="Schedules"
				subheader={schedulesSubheader(daemonRunning, activeScheduleCount)}
				fieldLabel={labels[editField]}
				value={current.value}
				multiline={current.multiline}
				placeholder={
					editField === "cron"
						? "e.g. every weekday at 9am, 0 9 * * *"
						: undefined
				}
				onSubmit={handleFieldEditSubmit}
				onCancel={() => {
					setEditField(null);
					setScreen("schedule");
				}}
			/>
		);
	}

	if (screen === "select" && selectField) {
		if (selectField === "enabled") {
			return (
				<FieldSelector
					appTitle="Schedules"
					subheader={schedulesSubheader(daemonRunning, activeScheduleCount)}
					fieldLabel="Enabled"
					options={["Yes", "No"]}
					currentValue={form.enabled ? "Yes" : "No"}
					onSubmit={handleSelectSubmit}
					onCancel={() => {
						setSelectField(null);
						setScreen("schedule");
					}}
				/>
			);
		}
		return (
			<FieldSelector
				appTitle="Schedules"
				subheader={schedulesSubheader(daemonRunning, activeScheduleCount)}
				fieldLabel="Persona"
				options={personaNames}
				currentValue={form.personaName}
				onSubmit={handleSelectSubmit}
				onCancel={() => {
					setSelectField(null);
					setScreen("schedule");
				}}
			/>
		);
	}

	if (screen === "schedule") {
		return (
			<ScheduleBrowse
				title="Schedules"
				breadcrumb={breadcrumb}
				items={browseItems}
				selectedIndex={browseIndex}
				daemonRunning={daemonRunning}
				activeScheduleCount={activeScheduleCount}
				statusMessage={statusMessage}
				saving={saving}
				running={running}
				onSelect={setBrowseIndex}
				onSelectItem={handleBrowseItem}
				onSave={handleSave}
				onBack={handleBack}
			/>
		);
	}

	return (
		<ScheduleList
			schedules={schedules}
			selectedIndex={selectedIndex}
			daemonRunning={daemonRunning}
			activeScheduleCount={activeScheduleCount}
			onSelect={setSelectedIndex}
			onSelectSchedule={openSchedule}
			onCreate={handleCreate}
			onBack={handleListBack}
		/>
	);
}

export function runSchedulesUI(): void {
	const profile = detectTerminalProfile();
	render(<SchedulesApp />, {
		kittyKeyboard: {
			mode: resolveKittyKeyboardMode(profile),
			flags: ["disambiguateEscapeCodes"],
		},
	});
}
