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
	next_cursor?: string | null;
}

const COMPLETED_FETCH_PAGE_MAX = 200;
const COMPLETED_FETCH_MAX_PAGES = 100;

interface TodoistOpenTaskResponse {
	id: string;
	content: string;
	description?: string;
	priority: number;
	project_id: string;
	section_id?: string;
	checked?: boolean;
	is_deleted?: boolean;
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
	/** ISO 8601 date-time for the due (Todoist `due_datetime`). */
	dueDatetime?: string;
	priority?: 1 | 2 | 3 | 4;
	/** Label names to set on the task (replaces existing labels for this task). */
	labels?: string[];
}

export interface TodoistTaskCreateInput {
	readonly content: string;
	readonly description?: string;
	readonly projectId?: string;
	readonly sectionId?: string;
	readonly parentTaskId?: string;
	readonly dueDate?: string;
	readonly dueString?: string;
	readonly priority?: 1 | 2 | 3 | 4;
}

export async function testTodoistConnection(): Promise<void> {
	await todoistRequest(`${TODOIST_API_BASE}/projects`);
}

const TASKS_PAGE_MAX = 200;
/** Todoist paginates `GET /tasks`; shared projects often appear before inbox on early pages. */
const TASKS_FETCH_MAX_PAGES = 100;

function isActiveOpenTaskRow(task: TodoistOpenTaskResponse): boolean {
	if (task.is_deleted === true) {
		return false;
	}
	if (task.checked === true) {
		return false;
	}
	return true;
}

/**
 * Loads **active** (incomplete) tasks from Todoist `GET /api/v1/tasks` only.
 * Todoist documents that endpoint as active tasks; completed work is listed via
 * `tasks/completed/...` (see {@link fetchCompletedTasks}). Rows with `checked: true` or
 * `is_deleted: true` are dropped if they ever appear.
 *
 * @param limit When set, returns at most this many tasks. When omitted, fetches every page until the API has no more (still bounded by an internal max page count).
 */
export async function fetchOpenTasks(limit?: number): Promise<TodoistTask[]> {
	const collected: TodoistOpenTaskResponse[] = [];
	let cursor: string | null = null;

	for (
		let page = 0;
		page < TASKS_FETCH_MAX_PAGES &&
		(limit === undefined || collected.length < limit);
		page++
	) {
		const params = new URLSearchParams();
		params.set("limit", String(TASKS_PAGE_MAX));
		if (cursor) {
			params.set("cursor", cursor);
		}
		const response = await todoistRequest(
			`${TODOIST_API_BASE}/tasks?${params.toString()}`,
		);
		const { results, nextCursor } = parseOpenTasksPage(response);
		for (const task of results) {
			if (isActiveOpenTaskRow(task)) {
				collected.push(task);
			}
		}
		if (!nextCursor || results.length === 0) {
			break;
		}
		cursor = nextCursor;
	}

	const tasks = limit === undefined ? collected : collected.slice(0, limit);

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

/**
 * Completed tasks in the last 30 days (Todoist API window). Paginates when `limit` is omitted.
 * @param limit Max rows to return; omit to fetch all pages in the date window (bounded by max pages).
 */
export async function fetchCompletedTasks(
	limit?: number,
): Promise<TodoistCompletedTask[]> {
	const until = new Date();
	const since = new Date(until);
	since.setDate(since.getDate() - 30);

	const collected: TodoistCompletedTask[] = [];
	let cursor: string | null = null;

	for (
		let page = 0;
		page < COMPLETED_FETCH_MAX_PAGES &&
		(limit === undefined || collected.length < limit);
		page++
	) {
		const pageLimit =
			limit === undefined
				? COMPLETED_FETCH_PAGE_MAX
				: Math.min(
						COMPLETED_FETCH_PAGE_MAX,
						Math.max(1, limit - collected.length),
					);

		const params = new URLSearchParams({
			since: since.toISOString(),
			until: until.toISOString(),
			limit: String(pageLimit),
		});
		if (cursor) {
			params.set("cursor", cursor);
		}

		const response = (await todoistRequest(
			`${TODOIST_API_BASE}/tasks/completed/by_completion_date?${params.toString()}`,
		)) as TodoistCompletedResponse;

		const items = response.items ?? [];
		for (const task of items) {
			if (limit !== undefined && collected.length >= limit) {
				break;
			}
			collected.push({
				taskId: task.task_id ?? task.id ?? "unknown",
				content: task.content,
				completedAt: task.completed_at,
				projectId: task.project_id ?? null,
			});
		}

		const raw = response.next_cursor;
		cursor = typeof raw === "string" && raw.length > 0 ? raw : null;
		if (!cursor || items.length === 0) {
			break;
		}
	}

	return limit === undefined ? collected : collected.slice(0, limit);
}

export async function createTask(
	input: TodoistTaskCreateInput,
): Promise<{ id: string; url: string; content: string }> {
	const body: Record<string, unknown> = {
		content: input.content,
	};
	if (input.description !== undefined && input.description !== "") {
		body.description = input.description;
	}
	if (input.projectId !== undefined && input.projectId !== "") {
		body.project_id = input.projectId;
	}
	if (input.sectionId !== undefined && input.sectionId !== "") {
		body.section_id = input.sectionId;
	}
	if (input.parentTaskId !== undefined && input.parentTaskId !== "") {
		body.parent_id = input.parentTaskId;
	}
	if (input.dueDate !== undefined && input.dueDate !== "") {
		body.due_date = input.dueDate;
	}
	if (input.dueString !== undefined && input.dueString !== "") {
		body.due_string = input.dueString;
	}
	if (input.priority !== undefined) {
		body.priority = input.priority;
	}

	const response = (await todoistRequest(`${TODOIST_API_BASE}/tasks`, {
		method: "POST",
		body: JSON.stringify(body),
	})) as { id?: string | number; url?: string; content?: string };

	const idRaw = response.id;
	if (idRaw === undefined || idRaw === null) {
		throw new Error("Todoist create task: response missing task id");
	}
	const id = String(idRaw);
	const url = response.url ?? "";
	const content = response.content ?? input.content;
	return { id, url, content };
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
	const requestBody: Record<string, unknown> = {
		content: updates.content,
		description: updates.description,
		due_date: updates.dueDate,
		due_string: updates.dueString,
		due_datetime: updates.dueDatetime,
		priority: updates.priority,
	};
	if (updates.labels !== undefined && updates.labels.length > 0) {
		requestBody.labels = updates.labels;
	}

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
			...options.headers,
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

function parseOpenTasksPage(response: unknown): {
	results: TodoistOpenTaskResponse[];
	nextCursor: string | null;
} {
	if (Array.isArray(response)) {
		return {
			results: response as TodoistOpenTaskResponse[],
			nextCursor: null,
		};
	}

	if (response && typeof response === "object") {
		const o = response as { results?: unknown; next_cursor?: unknown };
		const results = Array.isArray(o.results)
			? (o.results as TodoistOpenTaskResponse[])
			: [];
		const raw = o.next_cursor;
		const nextCursor = typeof raw === "string" && raw.length > 0 ? raw : null;
		return { results, nextCursor };
	}

	return { results: [], nextCursor: null };
}
