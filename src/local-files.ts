import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export interface ContextFile {
	path: string;
	content: string;
}

/** A local file and the loaded context file it accompanies. */
export interface LocalAddition {
	sibling: ContextFile;
	local: ContextFile;
}

export type LocalFileLoader = (dir: string) => ContextFile | undefined;

export const LOCAL_FILE_NAME = "AGENTS.local.md";

/** The context file names Pi discovers; a local file is only loaded next to one of these. */
const CONTEXT_FILE_NAME = /^(?:AGENTS(?:\.override)?|CLAUDE)\.md$/i;

/** Read `AGENTS.local.md` in `dir`. Throws when the file exists but cannot be read. */
export function readLocalFile(dir: string): ContextFile | undefined {
	const path = join(dir, LOCAL_FILE_NAME);
	if (!existsSync(path) || !statSync(path).isFile()) return undefined;
	return { path, content: readFileSync(path, "utf-8").replace(/^\uFEFF/, "") };
}

/**
 * Insert each directory's local file right after the context file Pi loaded from it.
 * Does not modify `contextFiles`.
 */
export function withLocalFiles(
	contextFiles: readonly ContextFile[],
	load: LocalFileLoader,
): { files: ContextFile[]; added: LocalAddition[] } {
	const present = new Set(contextFiles.map((file) => file.path));
	const files: ContextFile[] = [];
	const added: LocalAddition[] = [];
	for (const file of contextFiles) {
		files.push(file);
		if (!CONTEXT_FILE_NAME.test(basename(file.path))) continue;
		const local = load(dirname(file.path));
		if (!local || present.has(local.path)) continue;
		present.add(local.path);
		files.push(local);
		added.push({ sibling: file, local });
	}
	return { files, added };
}

/** How Pi renders one context file inside the `project_context` section. */
function renderInstructions({ path, content }: ContextFile): string {
	return `<project_instructions path="${path}">\n${content}\n</project_instructions>`;
}

/**
 * Add local files to a prompt that an earlier `before_agent_start` handler already froze
 * as text (by returning `systemPrompt`), which no longer follows `contextFiles`.
 * A local file is skipped when its sibling's block is not in the text.
 */
export function patchFrozenPrompt(prompt: string, added: readonly LocalAddition[]): string {
	let patched = prompt;
	for (const { sibling, local } of added) {
		const localBlock = renderInstructions(local);
		if (patched.includes(localBlock)) continue;
		const siblingBlock = renderInstructions(sibling);
		const start = patched.indexOf(siblingBlock);
		if (start === -1) continue;
		const end = start + siblingBlock.length;
		patched = `${patched.slice(0, end)}\n\n${localBlock}${patched.slice(end)}`;
	}
	return patched;
}
