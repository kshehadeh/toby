import type { CoreMessage } from "../../../ai/chat";
import type { Persona } from "../../../config/index";
import { composeSystemPromptWithPersona } from "../../../personas/prompt";
import type { TodoistCompletedTask, TodoistTask } from "../client";

function buildTodoistChatSystemPrompt(userInstruction: string): string {
	return `You are a Todoist assistant. You receive open tasks (and optionally recent completed tasks) as context. Use the tools to fetch tasks if you need more detail, then complete or update tasks according to the user's instruction.

Tools:
- fetchOpenTasks, fetchCompletedTasks — refresh context
- createTask — add a new task (optional projectId, sectionId, due, priority, description)
- completeTask — mark a task done
- updateTask — change an existing task: list title (content or title field), description, due (dueDate / dueString / dueDatetime), priority, labels
- askUser — **required** for any user choice: the CLI only collects answers through this tool. Do not ask the user to pick or confirm only in assistant text.

Rules:
- Never claim you created, completed, or updated a task unless the corresponding tool succeeded.
- If the instruction cannot be applied safely, explain why; if you need a decision, use askUser with concrete options.
- Prefer askUser when multiple tasks could match and disambiguation is needed.
- If the request is fully answered, stop without dangling "Would you like…?" questions in prose unless you call askUser for those options.

User instruction:
${userInstruction}
`;
}

export function buildTodoistChatSystemMessage(
	persona: Persona,
	userInstruction: string,
): CoreMessage {
	return {
		role: "system",
		content: composeSystemPromptWithPersona(
			buildTodoistChatSystemPrompt(userInstruction),
			persona,
		),
	};
}

export function buildTodoistChatUserMessage(
	openTasks: TodoistTask[],
	completedTasks: TodoistCompletedTask[],
): CoreMessage {
	const openSummary = openTasks.map((t) => ({
		id: t.id,
		content: t.content,
		priority: t.priority,
		due: t.due,
		projectId: t.projectId,
		url: t.url,
	}));
	const doneSummary = completedTasks.map((t) => ({
		taskId: t.taskId,
		content: t.content,
		completedAt: t.completedAt,
	}));

	return {
		role: "user",
		content: `Current Todoist context (apply the system instruction):

Open tasks (${openTasks.length}):
${JSON.stringify(openSummary, null, 2)}

Recently completed sample (${completedTasks.length}):
${JSON.stringify(doneSummary, null, 2)}`,
	};
}
