import { randomUUID } from "node:crypto";
import { getDb } from "../session-store";

export type UserToolLanguage = "typescript" | "applescript";
export type UserToolOutputKind = "text" | "json";
export type UserTool = {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly language: UserToolLanguage;
	readonly inputNames: readonly string[];
	readonly outputKind: UserToolOutputKind;
	readonly currentRevision: number;
	readonly source: string;
	readonly createdAt: string;
	readonly updatedAt: string;
};

export type UserToolDraft = Pick<
	UserTool,
	"name" | "description" | "language" | "inputNames" | "outputKind" | "source"
>;

function parseRow(row: Record<string, unknown>): UserTool {
	return {
		id: row.id as string,
		name: row.name as string,
		description: (row.description as string | null) ?? "",
		language: row.language as UserToolLanguage,
		inputNames: JSON.parse(row.input_names_json as string) as string[],
		outputKind: row.output_kind as UserToolOutputKind,
		currentRevision: row.current_revision as number,
		source: row.source as string,
		createdAt: row.created_at as string,
		updatedAt: row.updated_at as string,
	};
}

const SELECT = `SELECT t.*, r.source FROM user_tools t
  JOIN user_tool_revisions r ON r.tool_id = t.id AND r.revision = t.current_revision`;

export function getUserTool(id: string): UserTool | null {
	const row = getDb().query(`${SELECT} WHERE t.id = $id`).get({ $id: id });
	return row ? parseRow(row as Record<string, unknown>) : null;
}

export function listUserTools(): UserTool[] {
	return (
		getDb().query(`${SELECT} ORDER BY t.name COLLATE NOCASE`).all() as Record<
			string,
			unknown
		>[]
	).map(parseRow);
}

export function validateUserTool(raw: Record<string, unknown>): UserToolDraft {
	const name = typeof raw.name === "string" ? raw.name.trim() : "";
	const description =
		typeof raw.description === "string" ? raw.description.trim() : "";
	const source = typeof raw.source === "string" ? raw.source.trim() : "";
	const language = raw.language;
	const outputKind = raw.outputKind;
	const inputNames = raw.inputNames;
	if (!name || name.length > 100)
		throw new Error("Tool name must be 1–100 characters");
	if (!source || source.length > 100_000)
		throw new Error("Source must be 1–100,000 characters");
	if (language !== "typescript" && language !== "applescript")
		throw new Error("Unsupported tool language");
	if (outputKind !== "text" && outputKind !== "json")
		throw new Error("Output must be text or JSON");
	if (
		!Array.isArray(inputNames) ||
		inputNames.length > 20 ||
		inputNames.some(
			(item) =>
				typeof item !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(item),
		)
	)
		throw new Error(
			"Inputs must be up to 20 unique names using letters, digits, and underscores",
		);
	if (new Set(inputNames).size !== inputNames.length)
		throw new Error("Input names must be unique");
	return {
		name,
		description,
		source,
		language,
		outputKind,
		inputNames: inputNames as string[],
	};
}

export function saveUserTool(draft: UserToolDraft, id?: string): UserTool {
	const db = getDb();
	const existing = id ? getUserTool(id) : null;
	if (id && !existing) throw new Error("Tool not found");
	const toolId = id ?? `tool.${randomUUID()}`;
	const revision = (existing?.currentRevision ?? 0) + 1;
	const now = new Date().toISOString();
	db.transaction(() => {
		if (existing) {
			db.query(`UPDATE user_tools SET name=$name, description=$description, language=$language,
          input_names_json=$inputs, output_kind=$output, current_revision=$revision, updated_at=$now WHERE id=$id`).run(
				{
					$id: toolId,
					$name: draft.name,
					$description: draft.description,
					$language: draft.language,
					$inputs: JSON.stringify(draft.inputNames),
					$output: draft.outputKind,
					$revision: revision,
					$now: now,
				},
			);
		} else {
			db.query(`INSERT INTO user_tools (id, name, description, language, input_names_json,
          output_kind, current_revision, created_at, updated_at)
          VALUES ($id, $name, $description, $language, $inputs, $output, $revision, $now, $now)`).run(
				{
					$id: toolId,
					$name: draft.name,
					$description: draft.description,
					$language: draft.language,
					$inputs: JSON.stringify(draft.inputNames),
					$output: draft.outputKind,
					$revision: revision,
					$now: now,
				},
			);
		}
		db.query(`INSERT INTO user_tool_revisions (tool_id, revision, source, created_at)
      VALUES ($id, $revision, $source, $now)`).run({
			$id: toolId,
			$revision: revision,
			$source: draft.source,
			$now: now,
		});
	})();
	const saved = getUserTool(toolId);
	if (!saved) throw new Error("Tool could not be loaded after saving");
	return saved;
}

export function listToolUses(id: string): string[] {
	const rows = getDb()
		.query("SELECT id, definition_json FROM flows WHERE builtin = 0")
		.all() as Array<{ id: string; definition_json: string }>;
	return rows
		.filter((row) => {
			try {
				const doc = JSON.parse(row.definition_json) as {
					nodes?: Array<{ tool?: { userToolId?: string } }>;
				};
				return doc.nodes?.some((node) => node.tool?.userToolId === id);
			} catch {
				return false;
			}
		})
		.map((row) => row.id);
}

export function deleteUserTool(id: string): void {
	const uses = listToolUses(id);
	if (uses.length > 0)
		throw new Error(`Tool is used by ${uses.length} flow(s)`);
	const db = getDb();
	db.transaction(() => {
		db.query("DELETE FROM user_tool_revisions WHERE tool_id = $id").run({
			$id: id,
		});
		db.query("DELETE FROM user_tools WHERE id = $id").run({ $id: id });
	})();
}
