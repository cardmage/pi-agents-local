/**
 * End-to-end tests: run the installed `pi` CLI with this extension against a local mock
 * OpenAI-compatible server and inspect the system prompt in the requests it receives.
 *
 * Each run uses a throwaway agent directory, so user configuration, credentials and sessions
 * are not touched and no real provider is called. Skipped when `pi` is not installed; set
 * PI_CLI to the path of pi's `cli.js` to use a specific install.
 */

import assert from "node:assert/strict";
import { type ChildProcessWithoutNullStreams, execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const EXTENSION = join(here, "..");
const FREEZE_PROMPT = join(here, "fixtures", "freeze-prompt.ts");
const STRIP_CONTEXT = join(here, "fixtures", "strip-context.ts");
const RELOAD_COMMAND = join(here, "fixtures", "reload-command.ts");
const RUN_TIMEOUT_MS = 60_000;

function findPiCli(): string | undefined {
	if (process.env.PI_CLI) return process.env.PI_CLI;
	try {
		const root = execSync("npm root -g", { encoding: "utf-8" }).trim();
		const cli = join(root, "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");
		return existsSync(cli) ? cli : undefined;
	} catch {
		return undefined;
	}
}

const piCli = findPiCli();

interface ChatRequest {
	messages: Array<{ role: string; content: unknown }>;
}

/** The system prompt as the provider received it. */
function systemPrompt(request: ChatRequest): string {
	return request.messages
		.filter((message) => message.role === "system" || message.role === "developer")
		.map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
		.join("\n");
}

function userPrompts(request: ChatRequest): string {
	return JSON.stringify(request.messages.filter((message) => message.role === "user"));
}

function count(text: string, needle: string): number {
	return text.split(needle).length - 1;
}

function assertInOrder(text: string, markers: string[]): void {
	let from = 0;
	for (const marker of markers) {
		assert.equal(count(text, marker), 1, `expected exactly one "${marker}"`);
		const index = text.indexOf(marker, from);
		assert.notEqual(index, -1, `expected "${marker}" after the markers before it (order: ${markers.join(" < ")})`);
		from = index;
	}
}

describe("pi CLI with pi-agents-local", { skip: piCli ? false : "pi CLI not found" }, () => {
	const requests: ChatRequest[] = [];
	let server: Server;
	let port: number;
	let root: string;
	let agentDir: string;
	let project: string;

	before(async () => {
		server = createServer((req, res) => {
			let body = "";
			req.on("data", (chunk) => {
				body += chunk;
			});
			req.on("end", () => {
				requests.push(JSON.parse(body));
				const chunk = (delta: object, finishReason: string | null, usage?: object) =>
					`data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 0, model: "mock-model", choices: [{ index: 0, delta, finish_reason: finishReason }], ...(usage ? { usage } : {}) })}\n\n`;
				res.writeHead(200, { "content-type": "text/event-stream" });
				res.write(chunk({ role: "assistant", content: "mock-ok" }, null));
				res.write(chunk({}, "stop", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }));
				res.end("data: [DONE]\n\n");
			});
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		port = (server.address() as AddressInfo).port;
	});

	after(async () => {
		await new Promise((resolve) => server.close(resolve));
	});

	beforeEach(() => {
		requests.length = 0;
		root = mkdtempSync(join(tmpdir(), "agents-local-e2e-"));
		agentDir = join(root, "agent");
		project = join(root, "project");
		mkdirSync(join(project, "sub", "deep"), { recursive: true });
		mkdirSync(agentDir);
		writeFileSync(
			join(agentDir, "models.json"),
			JSON.stringify({
				providers: {
					mock: {
						baseUrl: `http://127.0.0.1:${port}/v1`,
						api: "openai-completions",
						apiKey: "test",
						models: [{ id: "mock-model" }],
					},
				},
			}),
		);
		writeFileSync(join(agentDir, "AGENTS.md"), "GLOBAL-TEAM\n");
		writeFileSync(join(agentDir, "AGENTS.local.md"), "GLOBAL-MINE\n");
		writeFileSync(join(project, "AGENTS.md"), "ROOT-TEAM\n");
		writeFileSync(join(project, "AGENTS.local.md"), "ROOT-MINE\n");
		writeFileSync(join(project, "sub", "AGENTS.md"), "SUB-TEAM\n");
		writeFileSync(join(project, "sub", "AGENTS.local.md"), "SUB-MINE\n");
		// No AGENTS.md next to this one.
		writeFileSync(join(project, "sub", "deep", "AGENTS.local.md"), "DEEP-MINE\n");
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	});

	/** Only extensions named with `-e` load, unless `args` has `--discover-extensions`. */
	function spawnPi(args: string[], cwd: string): ChildProcessWithoutNullStreams {
		// Do not leak the calling pi session's PI_* variables into the pi under test.
		const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("PI_")));
		const discover = args.includes("--discover-extensions");
		return spawn(
			process.execPath,
			[
				piCli as string,
				...(discover ? [] : ["--no-extensions"]),
				...["--no-skills", "--no-prompt-templates", "--no-themes", "--provider", "mock", "--model", "mock-model"],
				...args.filter((arg) => arg !== "--discover-extensions"),
			],
			{ cwd, env: { ...env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" } },
		);
	}

	/** Run `pi -p` and return the single request it sent. */
	async function printRun(args: string[], cwd: string, prompt = "hello"): Promise<ChatRequest> {
		const before = requests.length;
		const proc = spawnPi([...args, "-p", prompt], cwd);
		proc.stdin.end();
		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		proc.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		const timer = setTimeout(() => proc.kill(), RUN_TIMEOUT_MS);
		const code = await new Promise((resolve) => proc.on("close", resolve));
		clearTimeout(timer);
		assert.equal(code, 0, `pi exited with ${code}\nstdout: ${stdout}\nstderr: ${stderr}`);
		assert.match(stdout, /mock-ok/);
		assert.equal(requests.length, before + 1, "expected one provider request");
		return requests[requests.length - 1];
	}

	const withExtension = ["-e", EXTENSION, "--no-session"];

	const sub = () => join(project, "sub");
	const deep = () => join(project, "sub", "deep");
	const ALL = ["GLOBAL-TEAM", "GLOBAL-MINE", "ROOT-TEAM", "ROOT-MINE", "SUB-TEAM", "SUB-MINE"];

	it("adds each AGENTS.local.md right after the AGENTS.md of its directory", async () => {
		const prompt = systemPrompt(await printRun(withExtension, sub()));
		assertInOrder(prompt, ALL);
		assert.ok(prompt.includes(`<project_instructions path="${join(project, "AGENTS.local.md")}">`));
	});

	it("does not load an AGENTS.local.md that has no AGENTS.md next to it", async () => {
		const prompt = systemPrompt(await printRun(withExtension, deep()));
		assertInOrder(prompt, ALL);
		assert.equal(count(prompt, "DEEP-MINE"), 0);
	});

	it("loads nothing when there is no AGENTS.md at all", async () => {
		for (const dir of [agentDir, project, sub()]) rmSync(join(dir, "AGENTS.md"));
		const prompt = systemPrompt(await printRun(withExtension, deep()));
		assert.equal(count(prompt, "-MINE"), 0);
		assert.equal(count(prompt, "<project_context>"), 0);
	});

	it("pairs with CLAUDE.md and AGENTS.override.md when those are what pi loads", async () => {
		rmSync(join(sub(), "AGENTS.md"));
		writeFileSync(join(sub(), "CLAUDE.md"), "SUB-CLAUDE\n");
		writeFileSync(join(project, "AGENTS.override.md"), "ROOT-OVERRIDE\n");
		const prompt = systemPrompt(await printRun(withExtension, sub()));
		assertInOrder(prompt, ["GLOBAL-TEAM", "GLOBAL-MINE", "ROOT-OVERRIDE", "ROOT-MINE", "SUB-CLAUDE", "SUB-MINE"]);
		assert.equal(count(prompt, "ROOT-TEAM"), 0);
	});

	it("loads as a pi package listed in settings.json", async () => {
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [EXTENSION] }));
		assertInOrder(systemPrompt(await printRun(["--discover-extensions", "--no-session"], sub())), ALL);
	});

	it("control: without the extension pi does not load AGENTS.local.md", async () => {
		const prompt = systemPrompt(await printRun(["--no-session"], sub()));
		assertInOrder(prompt, ["GLOBAL-TEAM", "ROOT-TEAM", "SUB-TEAM"]);
		assert.equal(count(prompt, "-MINE"), 0);
	});

	for (const flag of ["--no-context-files", "-nc"]) {
		it(`loads nothing with ${flag}`, async () => {
			const prompt = systemPrompt(await printRun([...withExtension, flag], sub()));
			assert.equal(count(prompt, "-MINE"), 0);
			assert.equal(count(prompt, "-TEAM"), 0);
		});
	}

	it("gives the same prompt whether it loads before or after an extension that freezes the prompt", async () => {
		// pi-memory does this: it returns `systemPrompt`, after which pi ignores `contextFiles`.
		const first = systemPrompt(await printRun(["-e", FREEZE_PROMPT, "-e", EXTENSION, "--no-session"], sub()));
		const last = systemPrompt(await printRun(["-e", EXTENSION, "-e", FREEZE_PROMPT, "--no-session"], sub()));
		assertInOrder(first, [...ALL, "</project_context>", "FROZEN-SUFFIX"]);
		assert.equal(first, last);
	});

	for (const [order, extensions] of [
		["loaded before", ["-e", STRIP_CONTEXT, "-e", EXTENSION]],
		["loaded after", ["-e", EXTENSION, "-e", STRIP_CONTEXT]],
	] as const) {
		it(`adds nothing when an extension ${order} it removes the project context`, async () => {
			const prompt = systemPrompt(await printRun([...extensions, "--no-session"], sub()));
			assert.equal(count(prompt, "CHILD-BOUNDARY"), 1);
			assert.equal(count(prompt, "-MINE"), 0);
			assert.equal(count(prompt, "-TEAM"), 0);
		});
	}

	it("keeps a single copy when a session is continued", async () => {
		const session = ["-e", EXTENSION, "--session-dir", join(root, "sessions")];
		await printRun(session, project, "first prompt");
		const second = await printRun([...session, "--continue"], project, "second prompt");
		assert.match(userPrompts(second), /first prompt/, "the second run continues the first session");
		assert.match(userPrompts(second), /second prompt/);
		assertInOrder(systemPrompt(second), ["GLOBAL-TEAM", "GLOBAL-MINE", "ROOT-TEAM", "ROOT-MINE"]);
	});

	it("reads a local file once per session and again after a reload or a new session", async () => {
		const proc = spawnPi(["-e", EXTENSION, "-e", RELOAD_COMMAND, "--no-session", "--mode", "rpc"], project);
		const rpc = new RpcClient(proc);
		try {
			const prompt = async (message: string): Promise<string> => {
				const before = requests.length;
				rpc.send({ type: "prompt", message });
				await rpc.next((record) => record.type === "agent_settled");
				assert.equal(requests.length, before + 1, "expected one provider request");
				return systemPrompt(requests[requests.length - 1]);
			};
			/** Run an extension command and return the notifications it showed. */
			const command = async (message: string): Promise<string[]> => {
				const notices: string[] = [];
				rpc.send({ id: message, type: "prompt", message });
				const response = await rpc.next((record) => {
					if (record.type === "extension_ui_request" && record.method === "notify") notices.push(String(record.message));
					return record.type === "response" && record.id === message;
				});
				assert.equal(response.success, true, JSON.stringify(response));
				return notices;
			};
			const localPath = join(project, "AGENTS.local.md");

			assertInOrder(await prompt("one"), ["ROOT-TEAM", "ROOT-MINE"]);

			// Edited mid-session: the session keeps what it loaded, like AGENTS.md.
			writeFileSync(localPath, "ROOT-EDITED\n");
			const second = await prompt("two");
			assertInOrder(second, ["ROOT-TEAM", "ROOT-MINE"]);
			assert.equal(count(second, "ROOT-EDITED"), 0);

			const listed = await command("/agents-local");
			assert.equal(listed.length, 1);
			assert.ok(listed[0].includes(localPath), `unexpected notice: ${listed[0]}`);

			await command("/do-reload");
			const third = await prompt("three");
			assertInOrder(third, ["ROOT-TEAM", "ROOT-EDITED"]);
			assert.equal(count(third, "ROOT-MINE"), 0);

			writeFileSync(localPath, "ROOT-AGAIN\n");
			rpc.send({ id: "new", type: "new_session" });
			await rpc.next((record) => record.type === "response" && record.id === "new");
			const fourth = await prompt("four");
			assertInOrder(fourth, ["ROOT-TEAM", "ROOT-AGAIN"]);
			assert.equal(count(fourth, "ROOT-EDITED"), 0);

			// Removed: nothing is added any more.
			rmSync(localPath);
			await command("/do-reload");
			const fifth = await prompt("five");
			assert.equal(count(fifth, "ROOT-TEAM"), 1);
			assert.equal(count(fifth, "ROOT-AGAIN"), 0);
			const none = await command("/agents-local");
			assert.equal(none.length, 1);
			assert.ok(!none[0].includes(localPath), `unexpected notice: ${none[0]}`);
		} finally {
			await rpc.close();
		}
	});
});

type RpcRecord = Record<string, unknown>;

/** Minimal JSONL client for `pi --mode rpc`. */
class RpcClient {
	private readonly records: RpcRecord[] = [];
	private cursor = 0;
	private buffer = "";
	private stderr = "";
	private wake: (() => void) | undefined;
	private exited = false;
	private readonly proc: ChildProcessWithoutNullStreams;

	constructor(proc: ChildProcessWithoutNullStreams) {
		this.proc = proc;
		proc.stdout.setEncoding("utf-8");
		proc.stdout.on("data", (chunk: string) => {
			this.buffer += chunk;
			const lines = this.buffer.split("\n");
			this.buffer = lines.pop() ?? "";
			for (const line of lines) {
				if (line.trim()) this.records.push(JSON.parse(line));
			}
			this.wake?.();
		});
		proc.stderr.on("data", (chunk) => {
			this.stderr += chunk;
		});
		proc.on("close", () => {
			this.exited = true;
			this.wake?.();
		});
	}

	send(command: RpcRecord): void {
		this.proc.stdin.write(`${JSON.stringify(command)}\n`);
	}

	/** The next record matching `predicate` among those not yet consumed. */
	async next(predicate: (record: RpcRecord) => boolean): Promise<RpcRecord> {
		const deadline = Date.now() + RUN_TIMEOUT_MS;
		while (true) {
			while (this.cursor < this.records.length) {
				const record = this.records[this.cursor++];
				if (predicate(record)) return record;
			}
			const remaining = deadline - Date.now();
			if (this.exited || remaining <= 0) {
				throw new Error(`${this.exited ? "pi exited" : "timed out"} waiting for an RPC record\nstderr: ${this.stderr}`);
			}
			await new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, remaining);
				this.wake = () => {
					clearTimeout(timer);
					resolve();
				};
			});
		}
	}

	async close(): Promise<void> {
		if (this.exited) return;
		const closed = new Promise((resolve) => this.proc.on("close", resolve));
		this.proc.stdin.end();
		const timer = setTimeout(() => this.proc.kill(), 10_000);
		await closed;
		clearTimeout(timer);
	}
}
