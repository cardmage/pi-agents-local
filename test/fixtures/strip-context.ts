/**
 * Test fixture: removes project context from the run, like pi-subagents does for a child
 * that does not inherit project context (clears `contextFiles` and strips the frozen text).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", (event) => {
		event.systemPromptOptions.contextFiles = [];
		return {
			systemPrompt: `${event.systemPrompt.replace(/<project_context>[\s\S]*?<\/project_context>/g, "")}\n\nCHILD-BOUNDARY`,
		};
	});
}
