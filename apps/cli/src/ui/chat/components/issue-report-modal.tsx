import { Box, Text, useInput } from "ink";
import React, { useState } from "react";
import { MultilineTextArea, ViewModal } from "../../shared";
import { useMultilineInput } from "../../shared/use-multiline-input";
import { ACCENT } from "../constants";

export type IssueType = "bug" | "feature";

interface IssueReportModalProps {
	readonly termCols: number;
	readonly onSubmit: (type: IssueType, details: string) => void;
	readonly onCancel: () => void;
}

const ISSUE_TYPES: readonly IssueType[] = ["bug", "feature"];

export function IssueReportModal({
	termCols,
	onSubmit,
	onCancel,
}: IssueReportModalProps) {
	const [type, setType] = useState<IssueType>("bug");
	const [details, setDetails] = useState("");
	const [focus, setFocus] = useState<"type" | "details">("type");

	const { cursorIndex } = useMultilineInput({
		value: details,
		onChange: setDetails,
		onSubmit: (value) => {
			const trimmed = value.trim();
			if (trimmed) {
				onSubmit(type, trimmed);
			}
		},
		active: focus === "details",
		enterMode: "newline",
		onCancel,
	});

	useInput((_input, key) => {
		if (focus === "type") {
			if (key.escape) {
				onCancel();
				return;
			}
			if (key.upArrow || key.leftArrow) {
				setType("bug");
				return;
			}
			if (key.downArrow || key.rightArrow) {
				setType("feature");
				return;
			}
			if (key.return || key.tab) {
				setFocus("details");
				return;
			}
			return;
		}

		// focus === "details"
		if (key.tab && !key.shift) {
			setFocus("type");
		}
	});

	const contentWidth = Math.max(8, termCols - 2);

	return (
		<ViewModal termCols={termCols} borderColor={ACCENT}>
			<Box width={contentWidth}>
				<Text bold wrap="truncate-end">
					Report an issue
				</Text>
			</Box>
			<Box flexDirection="row" marginTop={1} width={contentWidth}>
				<Text>Category: </Text>
				{ISSUE_TYPES.map((t) => {
					const selected = t === type;
					return (
						<Box key={t} marginLeft={1}>
							<Text color={selected ? ACCENT : undefined} bold={selected}>
								{selected ? `● ${t}` : `○ ${t}`}
							</Text>
						</Box>
					);
				})}
			</Box>
			<Box marginTop={1} width={contentWidth}>
				<Text bold>Details</Text>
			</Box>
			<Box width={contentWidth}>
				<MultilineTextArea
					value={details}
					cursorIndex={cursorIndex}
					focus={focus === "details"}
					placeholder="Describe the issue or request..."
					rows={4}
					maxRows={8}
				/>
			</Box>
			<Box marginTop={1} width={contentWidth}>
				<Text dimColor wrap="truncate-end">
					{focus === "type"
						? "↑↓ select · Enter/Tab to details · Esc cancel"
						: "Ctrl+S submit · Tab to category · Esc cancel"}
				</Text>
			</Box>
		</ViewModal>
	);
}
