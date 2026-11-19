import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { type ContextFile, patchFrozenPrompt, readLocalFile, withLocalFiles } from "../src/local-files.ts";

const block = ({ path, content }: ContextFile) => `<project_instructions path="${path}">\n${content}\n</project_instructions>`;

describe("readLocalFile", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "agents-local-unit-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("returns undefined when the directory has no local file", () => {
		assert.equal(readLocalFile(dir), undefined);
	});

	it("reads AGENTS.local.md and strips a BOM", () => {
		writeFileSync(join(dir, "AGENTS.local.md"), "\uFEFFpersonal rules\n");
		assert.deepEqual(readLocalFile(dir), { path: join(dir, "AGENTS.local.md"), content: "personal rules\n" });
	});

	it("ignores a directory named AGENTS.local.md", () => {
		mkdirSync(join(dir, "AGENTS.local.md"));
		assert.equal(readLocalFile(dir), undefined);
	});

	it("does not read AGENTS.md itself", () => {
		writeFileSync(join(dir, "AGENTS.md"), "team rules");
		assert.equal(readLocalFile(dir), undefined);
	});
});

describe("withLocalFiles", () => {
	const global: ContextFile = { path: join("home", ".pi", "agent", "AGENTS.md"), content: "global" };
	const root: ContextFile = { path: join("repo", "AGENTS.md"), content: "team" };
	const pkg: ContextFile = { path: join("repo", "pkg", "CLAUDE.md"), content: "pkg" };
	const rootLocal: ContextFile = { path: join("repo", "AGENTS.local.md"), content: "mine" };
	const pkgLocal: ContextFile = { path: join("repo", "pkg", "AGENTS.local.md"), content: "mine too" };
	const locals = new Map([
		["repo", rootLocal],
		[join("repo", "pkg"), pkgLocal],
	]);
	const load = (dir: string) => locals.get(dir);

	it("inserts each local file right after the context file of its directory", () => {
		const input = [global, root, pkg];
		const { files, added } = withLocalFiles(input, load);
		assert.deepEqual(files, [global, root, rootLocal, pkg, pkgLocal]);
		assert.deepEqual(added, [
			{ sibling: root, local: rootLocal },
			{ sibling: pkg, local: pkgLocal },
		]);
		assert.deepEqual(input, [global, root, pkg], "input is not modified");
	});

	it("adds nothing when Pi loaded no context files", () => {
		assert.deepEqual(withLocalFiles([], load), { files: [], added: [] });
	});

	it("adds nothing for a directory whose context file Pi did not load", () => {
		const { files, added } = withLocalFiles([global, pkg], load);
		assert.deepEqual(files, [global, pkg, pkgLocal]);
		assert.equal(added.length, 1);
	});

	it("pairs with AGENTS.override.md", () => {
		const override: ContextFile = { path: join("repo", "AGENTS.override.md"), content: "override" };
		assert.deepEqual(withLocalFiles([override], load).files, [override, rootLocal]);
	});

	it("does not look next to files that are not Pi context files", () => {
		const other: ContextFile = { path: join("repo", "RULES.md"), content: "rules" };
		assert.deepEqual(withLocalFiles([other], load).files, [other]);
	});

	it("does not add a local file that is already present", () => {
		const input = [root, rootLocal];
		assert.deepEqual(withLocalFiles(input, load), { files: input, added: [] });
		const once = withLocalFiles([root, pkg], load).files;
		assert.deepEqual(withLocalFiles(once, load), { files: once, added: [] });
	});
});

describe("patchFrozenPrompt", () => {
	const root: ContextFile = { path: "/repo/AGENTS.md", content: "team" };
	const pkg: ContextFile = { path: "/repo/pkg/AGENTS.md", content: "pkg" };
	const rootLocal: ContextFile = { path: "/repo/AGENTS.local.md", content: "mine" };
	const pkgLocal: ContextFile = { path: "/repo/pkg/AGENTS.local.md", content: "mine too" };
	const prompt = (...files: ContextFile[]) =>
		`preamble\n\n<project_context>\nProject-specific instructions and guidelines:\n\n${files.map(block).join("\n\n")}\n</project_context>\n\n<cwd>\n/repo\n</cwd>\n\n## Memory\nfrozen by another extension`;

	it("inserts each local block right after its sibling's block", () => {
		const patched = patchFrozenPrompt(prompt(root, pkg), [
			{ sibling: root, local: rootLocal },
			{ sibling: pkg, local: pkgLocal },
		]);
		assert.equal(patched, prompt(root, rootLocal, pkg, pkgLocal));
	});

	it("still finds the sibling when text was added in front of the prompt", () => {
		const patched = patchFrozenPrompt(`HEADER\n\n${prompt(root)}`, [{ sibling: root, local: rootLocal }]);
		assert.equal(patched, `HEADER\n\n${prompt(root, rootLocal)}`);
	});

	it("leaves the prompt alone when the sibling's block was removed from it", () => {
		const text = "preamble\n\n<cwd>\n/repo\n</cwd>";
		assert.equal(patchFrozenPrompt(text, [{ sibling: root, local: rootLocal }]), text);
	});

	it("does not insert a block twice", () => {
		const text = prompt(root, rootLocal);
		assert.equal(patchFrozenPrompt(text, [{ sibling: root, local: rootLocal }]), text);
	});
});
