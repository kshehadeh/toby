import type { CoreMessage } from "../../../ai/chat";
import type { Persona } from "../../../config/index";
import type { TodoistCompletedTask, TodoistTask } from "../client";

const BASE_TODOIST_SUMMARY_SYSTEM_PROMPT = `You are a task management summarization assistant.

Your task is to summarize Todoist tasks clearly and concisely.

Output rules:
- Keep the summary brief but complete.
- Highlight urgent and high-priority work first.
- Call out overdue and due-soon tasks explicitly.
- Mention meaningful completed progress where relevant.
- Group lower-priority or repetitive tasks into short categories.
- Do not invent details that are not in the provided task snapshot.

Preferred format:
1) 1-3 sentence high-level overview
2) A short bullet list of highest-priority open work
3) One short sentence on recent completed progress`;

export function buildTodoistSummarySystemMessage(
	persona?: Persona,
): CoreMessage {
	const personaInstructions = persona?.instructions
		? `\n\nAdditional instructions from your persona "${persona.name}":\n${persona.instructions}`
		: "";

	return {
		role: "system",
		content: BASE_TODOIST_SUMMARY_SYSTEM_PROMPT + personaInstructions,
	};
}

export function buildTodoistSummaryUserMessage(
	openTasks: TodoistTask[],
	completedTasks: TodoistCompletedTask[],
): CoreMessage {
	const openTaskLines = openTasks
		.map(
			(task, index) =>
				`Open Task ${index + 1}
Content: ${task.content}
Description: ${task.description || "(none)"}
Priority: ${task.priority}
Due: ${task.due?.date ?? task.due?.datetime ?? task.due?.string ?? "(none)"}`,
		)
		.join("\n\n");

	const completedTaskLines = completedTasks
		.map(
			(task, index) =>
				`Completed Task ${index + 1}
Content: ${task.content}
Completed At: ${task.completedAt}`,
		)
		.join("\n\n");

	return {
		role: "user",
		content: `Summarize this Todoist snapshot:

Open tasks:
${openTaskLines || "(none)"}

Recently completed tasks:
${completedTaskLines || "(none)"}

Focus on what matters most now, mention deadlines and high-priority tasks first, and briefly group lower-priority work.`,
	};
}
