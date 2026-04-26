import { getTodoistCredentials } from "../../config/index";

const TODOIST_API_BASE = "https://api.todoist.com/api/v1";

export interface TodoistTask {
	id: string;
	content: string;
	description: string;
	priority: number;
	projectId: string;
	sectionId: string | null;
	due: {
		date?: string;
		datetime?: string;
		string?: string;
	} | null;
	url: string;
}

export interface TodoistCompletedTask {
	taskId: string;
	content: string;
	completedAt: string;
	projectId: string | null;
}

interface TodoistCompletedResponse {
	items?: Array<{
		id?: string;
		task_id: string;
		content: string;
		completed_at: string;
		project_id?: string;
	}>;
}

interface TodoistOpenTaskResponse {
	id: string;
	content: string;
	description?: string;
	priority: number;
	project_id: string;
	section_id?: string;
	due?: {
		date?: string;
		datetime?: string;
		string?: string;
	};
	url: string;
}

export interface TodoistTaskUpdateInput {
	content?: string;
	description?: string;
	dueDate?: string;
	dueString?: string;
	priority?: 1 | 2 | 3 | 4;
}

export async function testTodoistConnection(): Promise<void> {
	await todoistRequest(`${TODOIST_API_BASE}/projects`);
}

export async function fetchOpenTasks(limit = 30): Promise<TodoistTask[]> {
	const response = await todoistRequest(`${TODOIST_API_BASE}/tasks`);
	const tasks = toOpenTaskArray(response).slice(0, limit);

	return tasks.map((task) => ({
		id: task.id,
		content: task.content,
		description: task.description ?? "",
		priority: task.priority,
		projectId: task.project_id,
		sectionId: task.section_id ?? null,
		due: task.due
			? {
					date: task.due.date,
					datetime: task.due.datetime,
					string: task.due.string,
				}
			: null,
		url: task.url,
	}));
}

export async function fetchCompletedTasks(
	limit = 30,
): Promise<TodoistCompletedTask[]> {
	const until = new Date();
	const since = new Date(until);
	since.setDate(since.getDate() - 30);

	const params = new URLSearchParams({
		since: since.toISOString(),
		until: until.toISOString(),
		limit: String(limit),
	});
	const response = (await todoistRequest(
		`${TODOIST_API_BASE}/tasks/completed/by_completion_date?${params.toString()}`,
	)) as TodoistCompletedResponse;

	return (response.items ?? []).map((task) => ({
		taskId: task.task_id ?? task.id ?? "unknown",
		content: task.content,
		completedAt: task.completed_at,
		projectId: task.project_id ?? null,
	}));
}

export async function completeTask(taskId: string): Promise<void> {
	await todoistRequest(`${TODOIST_API_BASE}/tasks/${taskId}/close`, {
		method: "POST",
	});
}

export async function updateTask(
	taskId: string,
	updates: TodoistTaskUpdateInput,
): Promise<void> {
	const requestBody = {
		content: updates.content,
		description: updates.description,
		due_date: updates.dueDate,
		due_string: updates.dueString,
		priority: updates.priority,
	};

	await todoistRequest(`${TODOIST_API_BASE}/tasks/${taskId}`, {
		method: "POST",
		body: JSON.stringify(requestBody),
	});
}

async function todoistRequest(
	url: string,
	options: RequestInit = {},
): Promise<unknown> {
	const credentials = getTodoistCredentials();
	const response = await fetch(url, {
		...options,
		headers: {
			Authorization: `Bearer ${credentials.apiKey}`,
			"Content-Type": "application/json",
			...(options.headers ?? {}),
		},
	});

	if (!response.ok) {
		const message = await readResponseBodySafely(response);
		throw new Error(
			`Todoist API request failed (${response.status}): ${message}`,
		);
	}

	if (response.status === 204) {
		return undefined;
	}

	return response.json();
}

async function readResponseBodySafely(response: Response): Promise<string> {
	try {
		return await response.text();
	} catch {
		return "No response body";
	}
}

function toOpenTaskArray(response: unknown): TodoistOpenTaskResponse[] {
	if (Array.isArray(response)) {
		return response as TodoistOpenTaskResponse[];
	}

	if (response && typeof response === "object") {
		const maybeResults = (response as { results?: unknown }).results;
		if (Array.isArray(maybeResults)) {
			return maybeResults as TodoistOpenTaskResponse[];
		}
	}

	return [];
}
