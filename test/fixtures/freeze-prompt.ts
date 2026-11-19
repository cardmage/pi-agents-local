/**
 * Test fixture: freezes the system prompt as text, like pi-memory does when it appends
 * its "## Memory" section by returning `systemPrompt`.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n## Memory\nFROZEN-SUFFIX`,
	}));
}
