import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
	ConfirmDialog,
	deleteConfirmCopy,
} from "@/components/ConfirmDialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";
import type { SettingsItem } from "@/types";

interface ConfigureDetailProps {
	section: SettingsItem;
	values: Record<string, string>;
	isContainer?: boolean;
}

function isEditableField(field: SettingsItem): boolean {
	if (field.readOnly || field.masked) return false;
	if (
		field.kind === "hint" ||
		field.kind === "action" ||
		field.kind === "delete"
	) {
		return false;
	}
	return field.kind === "value" || field.kind === "select";
}

interface PendingDelete {
	action: string;
	body: Record<string, string>;
	title: string;
	message: string;
	confirmLabel: string;
}

export function ConfigureDetail({
	section,
	values,
	isContainer = false,
}: ConfigureDetailProps) {
	const queryClient = useQueryClient();
	const sectionKey = section.navKey ?? section.key;
	const [draft, setDraft] = useState<Record<string, string>>({});
	const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
		null,
	);

	useEffect(() => {
		setDraft({});
		setPendingDelete(null);
	}, [sectionKey]);

	const patchMutation = useMutation({
		mutationFn: (changes: Record<string, string>) =>
			api.patchConfigure(changes),
		onSuccess: () => {
			setDraft({});
			queryClient.invalidateQueries({ queryKey: ["configure-tree"] });
		},
	});

	const actionMutation = useMutation({
		mutationFn: ({
			action,
			body,
		}: {
			action: string;
			body: Record<string, string>;
		}) => api.configureAction(action, body),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["configure-tree"] });
		},
	});

	const getValue = (key: string) => draft[key] ?? values[key] ?? "";

	const runAction = (action: string, body: Record<string, string>) => {
		actionMutation.mutate({ action, body });
	};

	const requestDelete = (field: SettingsItem) => {
		const action = actionForKey(field.key);
		if (!action) return;
		const { title, message } = deleteConfirmCopy(field.label, section.label);
		setPendingDelete({
			action: action.name,
			body: action.body,
			title,
			message,
			confirmLabel: field.label,
		});
	};

	const confirmDelete = () => {
		if (!pendingDelete) return;
		runAction(pendingDelete.action, pendingDelete.body);
		setPendingDelete(null);
	};

	const saving = patchMutation.isPending || actionMutation.isPending;

	const fields = (section.children ?? []).filter(
		(c) =>
			!(c.kind === "section" && (c.children?.length ?? 0) > 0) &&
			!(c.kind === "hint" && c.key.endsWith("._empty")),
	);

	const deleteFields = fields.filter((f) => f.kind === "delete");
	const mainFields = fields.filter((f) => f.kind !== "delete");
	const editableFields = mainFields.filter(isEditableField);

	const pendingChanges = useMemo(() => {
		const changes: Record<string, string> = {};
		for (const field of editableFields) {
			const current = draft[field.key] ?? values[field.key] ?? "";
			const saved = values[field.key] ?? "";
			if (current !== saved) {
				changes[field.key] = current;
			}
		}
		return changes;
	}, [draft, values, editableFields]);

	const hasChanges = Object.keys(pendingChanges).length > 0;

	const handleSave = () => {
		if (!hasChanges) return;
		patchMutation.mutate(pendingChanges);
	};

	const showFooter = editableFields.length > 0 || deleteFields.length > 0;

	return (
		<>
			<Card className="border shadow-sm">
			<CardHeader className="pb-4">
				<CardTitle className="text-xl">{section.label}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-6">
				{isContainer && (
					<p className="text-muted-foreground text-sm">
						Select an item in the sidebar to view and edit its settings.
					</p>
				)}

				{mainFields.map((field) => (
					<ConfigureFieldRow
						key={field.navKey ?? field.key}
						field={field}
						value={getValue(field.key)}
						onChange={(v) => setDraft((d) => ({ ...d, [field.key]: v }))}
						onAction={runAction}
						saving={saving}
					/>
				))}

				{showFooter && (
					<>
						<Separator />
						<div className="flex flex-wrap items-center gap-2 pt-2">
							{editableFields.length > 0 && (
								<Button
									onClick={handleSave}
									disabled={saving || !hasChanges}
								>
									Save
								</Button>
							)}
							{deleteFields.map((field) => (
								<ConfigureFieldRow
									key={field.navKey ?? field.key}
									field={field}
									value={getValue(field.key)}
									onChange={() => {}}
									onAction={runAction}
									onDeleteRequest={requestDelete}
									saving={saving}
								/>
							))}
						</div>
					</>
				)}
			</CardContent>
		</Card>

			<ConfirmDialog
				open={pendingDelete !== null}
				onOpenChange={(open) => {
					if (!open) setPendingDelete(null);
				}}
				title={pendingDelete?.title ?? ""}
				message={pendingDelete?.message ?? ""}
				confirmLabel={pendingDelete?.confirmLabel ?? "Delete"}
				confirmVariant="destructive"
				disabled={saving}
				onConfirm={confirmDelete}
			/>
		</>
	);
}

function ConfigureFieldRow({
	field,
	value,
	onChange,
	onAction,
	onDeleteRequest,
	saving,
}: {
	field: SettingsItem;
	value: string;
	onChange: (v: string) => void;
	onAction: (action: string, body: Record<string, string>) => void;
	onDeleteRequest?: (field: SettingsItem) => void;
	saving: boolean;
}) {
	if (field.kind === "hint") {
		return (
			<div className="space-y-2">
				<Label className="text-muted-foreground">{field.label}</Label>
				<p className="text-sm whitespace-pre-wrap leading-relaxed">
					{field.currentValue ?? value}
				</p>
			</div>
		);
	}

	if (field.kind === "action") {
		const action = actionForKey(field.key);
		if (!action) return null;
		return (
			<Button
				variant="outline"
				disabled={saving}
				onClick={() => onAction(action.name, action.body)}
			>
				{field.label}
			</Button>
		);
	}

	if (field.kind === "delete") {
		if (!onDeleteRequest || !actionForKey(field.key)) return null;
		return (
			<Button
				variant="destructive"
				disabled={saving}
				onClick={() => onDeleteRequest(field)}
			>
				{field.label}
			</Button>
		);
	}

	if (field.readOnly || field.masked) {
		return (
			<div className="space-y-2">
				<Label>{field.label}</Label>
				<Badge variant="secondary">
					{value === "••••••" || value ? "Configured" : "Not set"}
				</Badge>
			</div>
		);
	}

	if (field.kind === "select" && field.options?.length) {
		return (
			<div className="space-y-2">
				<Label>{field.label}</Label>
				<Select value={value || field.options[0]} onValueChange={onChange}>
					<SelectTrigger className="max-w-md">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{field.options.map((opt) => (
							<SelectItem key={opt} value={opt}>
								{field.selectChoices?.find((c) => c.value === opt)?.label ??
									opt}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		);
	}

	return (
		<div className="space-y-2">
			<Label>{field.label}</Label>
			{field.multiline ? (
				<Textarea
					className="min-h-28 font-mono text-sm"
					value={value}
					onChange={(e) => onChange(e.target.value)}
				/>
			) : (
				<Input
					className="max-w-xl"
					value={value}
					onChange={(e) => onChange(e.target.value)}
				/>
			)}
		</div>
	);
}

function actionForKey(
	key: string,
): { name: string; body: Record<string, string> } | null {
	if (key === "personas._new") return { name: "create-persona", body: {} };
	const setDefault = /^personas\.(.+)\._setDefault$/.exec(key);
	if (setDefault)
		return {
			name: "set-default-persona",
			body: { personaName: setDefault[1] },
		};
	const deletePersona = /^personas\.(.+)\._delete$/.exec(key);
	if (deletePersona)
		return {
			name: "delete-persona",
			body: { personaName: deletePersona[1] },
		};
	const deleteSkill = /^skills\.(.+)\._delete$/.exec(key);
	if (deleteSkill)
		return { name: "delete-skill", body: { dirName: deleteSkill[1] } };
	if (key === "schedules._new") return { name: "create-schedule", body: {} };
	const deleteSchedule = /^schedules\.(.+)\._delete$/.exec(key);
	if (deleteSchedule)
		return {
			name: "delete-schedule",
			body: { scheduleId: deleteSchedule[1] },
		};
	return null;
}
