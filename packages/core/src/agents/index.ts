import "./definitions/dashboard-email-summary";
import "./definitions/dashboard-tasks-summary";
import "./definitions/dashboard-calendar-summary";

export type {
	AgentContextBag,
	AgentDefinition,
	AgentInputMap,
	AgentInputSource,
	AgentNodeDefinition,
	AgentNodePromptContext,
	AgentNodeTrace,
	AgentOutputMap,
	AgentResult,
	AgentRunOptions,
	LlmPrompterNodeDefinition,
	ToolExecutorNodeDefinition,
	ToolRef,
} from "./types";
export { AgentNodeError } from "./types";

export {
	clearAgentRegistry,
	getAgent,
	listAgents,
	registerAgent,
} from "./registry";

export { runAgent, runAgentDefinition } from "./runner";

export {
	getByPath,
	resolveNodeInputs,
	applyNodeOutputs,
} from "./resolve-inputs";

export {
	executeNamedTool,
	executeToolRef,
	resolveNamedTool,
	resolveStandardTool,
} from "./tool-resolve";
export type { ExecuteToolResult, ResolvedToolTarget } from "./tool-resolve";

export { emailDashboardSummaryAgent } from "./definitions/dashboard-email-summary";
export { tasksDashboardSummaryAgent } from "./definitions/dashboard-tasks-summary";
export { calendarDashboardSummaryAgent } from "./definitions/dashboard-calendar-summary";
