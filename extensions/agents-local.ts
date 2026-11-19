/**
 * pi-agents-local
 *
 * Loads `AGENTS.local.md` next to every context file Pi loaded (`AGENTS.md`,
 * `AGENTS.override.md`, `CLAUDE.md`), so team/project instructions stay in `AGENTS.md`
 * and personal additions live in `AGENTS.local.md`.
 *
 * A local file is added right after the context file in the same directory, and only when
 * Pi loaded that context file. So it is left out whenever that file is: with
 * `--no-context-files`, or when another extension removes context files (for example a
 * subagent that does not inherit project context).
 *
 * Like `AGENTS.md`, a local file is read once per session; `/reload` picks up edits.
 */

import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type ContextFile, LOCAL_FILE_NAME, type LocalFileLoader, patchFrozenPrompt, readLocalFile, withLocalFiles } from "../src/local-files.ts";

export default function agentsLocal(pi: ExtensionAPI) {
	// Per directory: the local file, or undefined when it has none. Kept for the session so
	// the prompt does not change (and miss the provider's cache) when a file is edited mid-session.
	// Pi creates a new extension instance for every reload and session replacement, so it starts empty.
	const cache = new Map<string, ContextFile | undefined>();
	const warnings: string[] = [];

	const load: LocalFileLoader = (dir) => {
		if (!cache.has(dir)) {
			let file: ContextFile | undefined;
			try {
				file = readLocalFile(dir);
			} catch (error) {
				warnings.push(`Could not read ${LOCAL_FILE_NAME} in ${dir}: ${error instanceof Error ? error.message : error}`);
			}
			cache.set(dir, file);
		}
		return cache.get(dir);
	};

	const reportWarnings = (ctx: ExtensionContext) => {
		for (const warning of warnings.splice(0)) {
			if (ctx.hasUI) ctx.ui.notify(warning, "warning");
			else console.error(`Warning: ${warning}`);
		}
	};

	pi.on("before_agent_start", (event, ctx) => {
		const options = event.systemPromptOptions;
		const { files, added } = withLocalFiles(options.contextFiles ?? [], load);
		reportWarnings(ctx);
		if (added.length === 0) return;

		// The prompt text as an earlier handler froze it, read before contextFiles changes.
		const frozen = options.forceSystemPrompt;
		options.contextFiles = files;
		if (frozen === undefined) return;
		const patched = patchFrozenPrompt(frozen, added);
		return patched === frozen ? undefined : { systemPrompt: patched };
	});

	pi.registerCommand("agents-local", {
		description: `Show the ${LOCAL_FILE_NAME} files added to the context`,
		handler: async (_args, ctx) => {
			const { added } = withLocalFiles(ctx.getSystemPromptOptions().contextFiles ?? [], load);
			reportWarnings(ctx);
			if (added.length === 0) {
				ctx.ui.notify(`No ${LOCAL_FILE_NAME} next to a loaded context file.`, "info");
				return;
			}
			const lines = added.map(({ sibling, local }) => `  ${local.path}  (with ${basename(sibling.path)})`);
			ctx.ui.notify(`${LOCAL_FILE_NAME} in context:\n${lines.join("\n")}`, "info");
		},
	});
}
