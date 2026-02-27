/**
 * Deterministic Observation Extractor
 *
 * Converts raw tool execution data into structured observations.
 * No AI calls — pure heuristic classification.
 * Runs on every tool.execute.after hook.
 *
 * Returns both the observation and the truncated tool output
 * (rawOutput) for downstream AI enrichment.
 */

import type { CreateObservationInput, ObservationType } from "./types"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RawToolData {
	tool: string
	args: Record<string, unknown>
	output: string
	title?: string
}

/** Result of deterministic extraction: observation + raw output for AI enrichment */
export interface ExtractionResult {
	observation: CreateObservationInput
	/** Truncated tool output (head+tail) for AI enrichment — NOT stored in SQLite */
	rawOutput: string
}

// ─── Skip list ───────────────────────────────────────────────────────────────

/** Tools that should NOT generate observations (our own tools, noisy tools) */
export const SKIP_TOOLS = new Set([
	"mem_search",
	"mem_save",
	"ltm_search",
	"observation_search",
	"get_mem",
	"get_tool_output",
	"TodoWrite",
	"TodoRead",
	"todowrite",
	"todoread",
	"pty_list",
	"pty_read",
	"pty_kill",
	"question",
])

// ─── Output Budgets ──────────────────────────────────────────────────────────

/** Per-tool character budget for rawOutput (passed to AI enrichment) */
const OUTPUT_BUDGETS: Record<string, number> = {
	Read: 4000,
	read: 4000,
	Write: 2000,
	write: 2000,
	Edit: 3000,
	edit: 3000,
	Bash: 4000,
	bash: 4000,
	Grep: 3000,
	grep: 3000,
	Glob: 2000,
	glob: 2000,
	web_search: 4000,
	"web-search": 4000,
}
const DEFAULT_OUTPUT_BUDGET = 2000

// ─── Privacy ─────────────────────────────────────────────────────────────────

/** Strip <private>...</private> tags, replacing content with [REDACTED] */
function stripPrivate(text: string): string {
	return text.replace(/<private>[\s\S]*?<\/private>/gi, "[REDACTED]")
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export function extractObservation(
	raw: RawToolData,
	sessionId: string,
	promptNumber: number | null,
): ExtractionResult | null {
	if (SKIP_TOOLS.has(raw.tool)) return null

	// Sanitize
	const args = sanitizeArgs(raw.args)
	const cleanOutput = stripPrivate(raw.output)
	const clean = { ...raw, args, output: cleanOutput }

	// Prepare truncated output for AI enrichment (head+tail)
	const budget = OUTPUT_BUDGETS[raw.tool] ?? DEFAULT_OUTPUT_BUDGET
	const rawOutput = truncate(cleanOutput, budget)

	let observation: CreateObservationInput

	switch (raw.tool) {
		case "read":
		case "Read":
			observation = extractRead(clean, sessionId, promptNumber)
			break
		case "write":
		case "Write":
			observation = extractWrite(clean, sessionId, promptNumber)
			break
		case "edit":
		case "Edit":
			observation = extractEdit(clean, sessionId, promptNumber)
			break
		case "bash":
		case "Bash":
			observation = extractBash(clean, sessionId, promptNumber)
			break
		case "grep":
		case "Grep":
			observation = extractGrep(clean, sessionId, promptNumber)
			break
		case "glob":
		case "Glob":
			observation = extractGlob(clean, sessionId, promptNumber)
			break
		case "web_search":
		case "web-search":
			observation = extractWebSearch(clean, sessionId, promptNumber)
			break
		default:
			observation = extractGeneric(clean, sessionId, promptNumber)
			break
	}

	return { observation, rawOutput }
}

// ─── Per-tool extractors ─────────────────────────────────────────────────────

function extractRead(raw: RawToolData, sessionId: string, pn: number | null): CreateObservationInput {
	const path = str(raw.args.filePath || raw.args.path || raw.args.file)
	const filename = basename(path)
	return {
		sessionId,
		type: "discovery",
		title: `Read ${filename || "file"}`,
		narrative: path ? `Read ${path}` : "Read a file",
		facts: [],
		concepts: conceptsFromPath(path),
		filesRead: path ? [path] : [],
		filesModified: [],
		toolName: raw.tool,
		promptNumber: pn,
	}
}

function extractWrite(raw: RawToolData, sessionId: string, pn: number | null): CreateObservationInput {
	const path = str(raw.args.filePath || raw.args.path || raw.args.file)
	const filename = basename(path)
	return {
		sessionId,
		type: "feature",
		title: `Wrote ${filename || "file"}`,
		narrative: path ? `Created/wrote ${path}` : "Wrote a file",
		facts: [],
		concepts: conceptsFromPath(path),
		filesRead: [],
		filesModified: path ? [path] : [],
		toolName: raw.tool,
		promptNumber: pn,
	}
}

function extractEdit(raw: RawToolData, sessionId: string, pn: number | null): CreateObservationInput {
	const path = str(raw.args.filePath || raw.args.path || raw.args.file)
	const filename = basename(path)
	const oldStr = str(raw.args.oldString || raw.args.old_string).slice(0, 100)
	const newStr = str(raw.args.newString || raw.args.new_string).slice(0, 100)

	// Classify: bugfix if "fix" in context, refactor if structural, else change
	const combined = `${oldStr} ${newStr} ${raw.output}`.toLowerCase()
	let type: ObservationType = "change"
	if (combined.includes("fix") || combined.includes("bug") || combined.includes("error")) type = "bugfix"
	else if (combined.includes("refactor") || combined.includes("rename") || combined.includes("move")) type = "refactor"

	const facts: string[] = []
	if (oldStr && newStr) facts.push(`${oldStr.trim()} → ${newStr.trim()}`)

	return {
		sessionId,
		type,
		title: `Edited ${filename || "file"}`,
		narrative: path ? `Edited ${path}` : "Edited a file",
		facts,
		concepts: conceptsFromPath(path),
		filesRead: [],
		filesModified: path ? [path] : [],
		toolName: raw.tool,
		promptNumber: pn,
	}
}

function extractBash(raw: RawToolData, sessionId: string, pn: number | null): CreateObservationInput {
	const cmd = str(raw.args.command || raw.args.cmd).slice(0, 200)
	const output = raw.output.slice(0, 500)
	const { type, title, concepts } = classifyBash(cmd, output)

	return {
		sessionId,
		type,
		title,
		narrative: `$ ${cmd}`,
		facts: output ? [output.slice(0, 300)] : [],
		concepts,
		filesRead: [],
		filesModified: [],
		toolName: raw.tool,
		promptNumber: pn,
	}
}

function extractGrep(raw: RawToolData, sessionId: string, pn: number | null): CreateObservationInput {
	const pattern = str(raw.args.pattern || raw.args.query)
	const matchCount = (raw.output.match(/\n/g) || []).length
	return {
		sessionId,
		type: "discovery",
		title: `Searched: ${pattern.slice(0, 60)}`,
		narrative: `grep for "${pattern}" — ${matchCount} matches`,
		facts: [],
		concepts: ["search"],
		filesRead: [],
		filesModified: [],
		toolName: raw.tool,
		promptNumber: pn,
	}
}

function extractGlob(raw: RawToolData, sessionId: string, pn: number | null): CreateObservationInput {
	const pattern = str(raw.args.pattern)
	const matchCount = (raw.output.match(/\n/g) || []).length
	return {
		sessionId,
		type: "discovery",
		title: `Glob: ${pattern.slice(0, 60)}`,
		narrative: `Found ${matchCount} files matching "${pattern}"`,
		facts: [],
		concepts: ["file-search"],
		filesRead: [],
		filesModified: [],
		toolName: raw.tool,
		promptNumber: pn,
	}
}

function extractWebSearch(raw: RawToolData, sessionId: string, pn: number | null): CreateObservationInput {
	const query = str(raw.args.query)
	return {
		sessionId,
		type: "discovery",
		title: `Web search: ${query.slice(0, 60)}`,
		narrative: `Searched the web for "${query}"`,
		facts: [],
		concepts: ["web-search", ...query.toLowerCase().split(/\s+/).slice(0, 3)],
		filesRead: [],
		filesModified: [],
		toolName: raw.tool,
		promptNumber: pn,
	}
}

function extractGeneric(raw: RawToolData, sessionId: string, pn: number | null): CreateObservationInput {
	const title = raw.title || `Used ${raw.tool}`
	return {
		sessionId,
		type: "discovery",
		title: title.slice(0, 120),
		narrative: `Tool: ${raw.tool}`,
		facts: [],
		concepts: [raw.tool.toLowerCase()],
		filesRead: [],
		filesModified: [],
		toolName: raw.tool,
		promptNumber: pn,
	}
}

// ─── Bash classifier ─────────────────────────────────────────────────────────

function classifyBash(
	cmd: string,
	output: string,
): { type: ObservationType; title: string; concepts: string[] } {
	const lc = cmd.toLowerCase()

	if (lc.startsWith("git ")) {
		const sub = lc.split(/\s+/)[1] || ""
		return { type: "change", title: `git ${sub}`, concepts: ["git", sub] }
	}
	if (lc.match(/^(npm|pnpm|yarn|bun)\s+(install|add|remove)/)) {
		return { type: "change", title: `Package: ${cmd.slice(0, 80)}`, concepts: ["packages", "dependencies"] }
	}
	if (lc.match(/^(npm|pnpm|yarn|bun)\s+(test|run\s+test)/)) {
		const passed = !output.includes("FAIL") && !output.includes("error")
		return { type: passed ? "discovery" : "bugfix", title: `Tests: ${passed ? "passed" : "failed"}`, concepts: ["tests"] }
	}
	if (lc.match(/^(npm|pnpm|yarn|bun)\s+(run\s+)?(build|lint)/)) {
		const sub = lc.includes("lint") ? "lint" : "build"
		return { type: "change", title: `${sub}: ${cmd.slice(0, 80)}`, concepts: [sub] }
	}
	if (lc.startsWith("docker") || lc.startsWith("docker-compose")) {
		return { type: "change", title: `Docker: ${cmd.slice(0, 80)}`, concepts: ["docker"] }
	}
	if (lc.match(/^(curl|wget|fetch)\s/)) {
		return { type: "discovery", title: `HTTP: ${cmd.slice(0, 80)}`, concepts: ["http", "api"] }
	}
	if (lc.match(/^(mkdir|cp|mv|rm|ln|chmod)\s/)) {
		return { type: "change", title: `FS: ${cmd.slice(0, 80)}`, concepts: ["filesystem"] }
	}

	return { type: "discovery", title: `$ ${cmd.slice(0, 80)}`, concepts: ["bash"] }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function str(val: unknown): string {
	if (typeof val === "string") return stripPrivate(val)
	if (val == null) return ""
	return stripPrivate(String(val))
}

/** Truncate keeping head + tail with an omission marker (60/40 split) */
function truncate(s: string, max: number): string {
	if (s.length <= max) return s
	const head = Math.ceil(max * 0.6)
	const tail = Math.floor(max * 0.4)
	const omitted = s.length - head - tail
	return `${s.slice(0, head)}\n...[${omitted} chars omitted]...\n${s.slice(-tail)}`
}

function basename(p: string): string {
	if (!p) return ""
	const parts = p.replace(/\\/g, "/").split("/")
	return parts[parts.length - 1] || ""
}

function conceptsFromPath(p: string): string[] {
	if (!p) return []
	const parts = p.replace(/\\/g, "/").split("/").filter(Boolean)
	const skip = new Set(["src", "lib", "dist", "build", "node_modules", ".", ".."])
	const concepts: string[] = []
	for (const part of parts.slice(0, -1)) {
		if (!skip.has(part) && part.length > 1) concepts.push(part.toLowerCase())
	}
	const ext = basename(p).split(".").pop()
	if (ext && ext.length <= 5) concepts.push(ext)
	return concepts.slice(0, 5)
}

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(args)) {
		if (typeof v === "string") {
			result[k] = stripPrivate(v.slice(0, 2000))
		} else {
			result[k] = v
		}
	}
	return result
}
