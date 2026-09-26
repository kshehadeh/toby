/** Instructions for scripts executed by Toby, not by Script Editor or a project checkout. */
export const APPLESCRIPT_GENERATION_GUIDANCE = `Write AppleScript for Toby's script-tool runner.

Runtime contract:
- Return one complete plain-text AppleScript source file. Start with an on run argv handler and close it with end run. Do not include Markdown, setup notes, or a Script Editor workflow.
- Toby passes each declared input as a string in argv, in the order listed in the request. Read them with item 1 of argv, item 2 of argv, and so on. Handle missing or malformed values with a useful error.
- For text output, return text from on run. For JSON output, return one valid JSON string; Toby parses it after osascript finishes. Do not rely on display alert, dialogs, or log output as the result.
- The script runs through /usr/bin/osascript in a temporary directory with the user's macOS permissions. It has no integration credentials or project files. The runner limits execution to 30 seconds and output to 1 MB.

AppleScript practice:
- Prefer an app's scripting dictionary and explicit application/document references. Use System Events UI scripting only when needed; check the target process and allow brief delays after UI changes.
- Keep repeated runs safe where possible: inspect existing files, windows, or settings before changing them. Avoid unnecessary activate commands that interrupt the user's workspace.
- Use path to home folder or other standard macOS locations instead of hard-coded personal paths.
- When do shell script needs a dynamic path or argument, use quoted form of its POSIX value. Do not use sudo, change system permissions, or download and execute remote code.
- Put fallible app, file, and shell operations in try/on error errMsg number errNum blocks. Surface a descriptive error rather than swallowing failures or opening an alert.
- If returning JSON built from dynamic text, escape it correctly; a string that merely looks like JSON is not enough.
- Keep handlers small and use standard AppleScript syntax and coercions.`;

export const TYPESCRIPT_GENERATION_GUIDANCE = `Write TypeScript for Toby's Bun script-tool runner.

Runtime contract:
- Return one complete plain-text TypeScript source file. Export a default async function run(input: Record<string, unknown>) that returns the requested result. Do not include Markdown, setup notes, or code fences.
- Each declared input is a string property on input. Check or convert values explicitly when the task needs another type.
- For text output, return a string. For JSON output, return a JSON-serializable value. Do not print the result to stdout.
- Toby runs this file in a fresh temporary directory with Bun and a minimal environment. No project files, installed packages, plugin modules, or integration credentials are available.
- Use only Bun APIs and built-in node:* modules when imports are needed. Do not import npm packages, relative files, or modules that are not part of the Bun runtime.
- The runner limits execution to 30 seconds, input to 256 KB, and output to 1 MB. Avoid work that can hang; throw useful errors for invalid inputs.
- Keep repeated runs safe where possible, use explicit paths, and avoid shell commands unless the task requires them.`;
