/**
 * LLM-Powered Memory Consolidation Engine
 *
 * During compaction, reads the session's observations and uses an LLM
 * to extract durable long-term memories in three categories:
 *   - Episodic: what happened (events, outcomes, tasks)
 *   - Semantic: what is known (facts, architecture, patterns)
 *   - Procedural: how to do things (workflows, recipes, commands)
 *
 * LLM routing delegated to shared llm.ts module.
 */

import type { Database } from "bun:sqlite"
import { getEnv } from "../../../tools/lib/get-env"
import {
	getObservationsBySession,
	getAllLTM,
	insertLTM,
	markConsolidated,
} from "./db"
import { resolveLLMConfig, callLLM, extractJson, type LLMOptions } from "./llm"
import type {
	Observation,
	LTMEntry,
	CreateLTMInput,
	ConsolidationResult,
	LogFn,
} from "./types"

// ─── Configuration ───────────────────────────────────────────────────────────

export interface ConsolidateOptions extends LLMOptions {}

// ─── Prompts ─────────────────────────────────────────────────────────────────

const CONSOLIDATION_SYSTEM = `You are the memory consolidation layer for an autonomous coding agent. You process raw session observations (tool calls, file edits, bash outputs) and distill them into durable long-term memories that will be useful in future sessions — potentially weeks later, with zero surrounding context.

## Memory Categories

EPISODIC — What happened this session. Decisions made, tasks completed, bugs fixed, failures encountered, approaches tried.
  Good: "Migrated auth from JWT to session cookies — JWT refresh was unreliable on mobile (see /workspace/auth_plan.md)"
  Bad: "Read some files about auth"

SEMANTIC — Stable facts about the codebase, architecture, environment, or domain. Things that remain true across sessions.
  Good: "Frontend uses Next.js App Router at apps/frontend/; API is Bun/Hono at services/kortix-api/ (port 8008)"
  Bad: "There is a frontend"

PROCEDURAL — How to do things. Concrete workflows, commands, debugging recipes, deploy steps. Must be actionable.
  Good: "To run DB migrations: cd packages/db && DATABASE_URL=... bunx drizzle-kit migrate"
  Bad: "Use drizzle for migrations"

## Rules

1. **Future-self test.** Would this memory help the agent in a fresh session with no context? If not, skip it.
2. **Specificity required.** Include file paths, command flags, error messages, version numbers. Vague memories are useless.
3. **Self-contained.** Each entry must make sense on its own — no "as mentioned above" or implicit references.
4. **Deduplicate strictly.** If EXISTING_LTM already captures a fact, add its ID to reinforced_ids. Only create new entries for genuinely new knowledge.
5. **Skip noise.** Ignore trivial file reads, generic glob/grep with no insight, routine tool usage that taught nothing.
6. **Capture failures and corrections.** What went wrong and why is often more valuable than what went right.
7. **Capture user preferences.** Communication style, tech choices, workflow habits — these are high-value memories.
8. **Concise but complete.** One clear sentence per memory. Add context field only when the sentence alone would be ambiguous.

## Output

Output ONLY valid JSON. No markdown fences, no commentary.

{
  "episodic": [
    { "content": "...", "caption": "10-15 word summary for quick scanning", "context": "optional clarifying detail", "tags": ["tag1"], "files": ["/path"], "source_observation_ids": [1,2] }
  ],
  "semantic": [ ... ],
  "procedural": [ ... ],
  "reinforced_ids": [5, 12]
}

Each entry MUST include a "caption" field: a 10-15 word summary suitable for a compact index. The caption should capture the essence of the memory without needing to read the full content.`

// ─── Main Entry ──────────────────────────────────────────────────────────────

/**
 * Consolidate a session's observations into long-term memories.
 * Called during the compaction hook.
 */
export async function consolidateMemories(
	db: Database,
	sessionId: string,
	log: LogFn,
	opts?: ConsolidateOptions,
): Promise<ConsolidationResult> {
	const empty: ConsolidationResult = { newMemories: [] }

	// 1. Get session observations
	const observations = getObservationsBySession(db, sessionId)
	if (observations.length === 0) return empty

	// 2. Resolve LLM provider
	const config = resolveLLMConfig(opts)
	if (!config) {
		log("warn", `[memory:consolidate] No LLM provider available — skipping consolidation`)
		return empty
	}

	// 3. Get existing LTM for dedup context
	const existingLTM = getAllLTM(db)

	// 4. Build prompt
	const userMessage = buildUserMessage(observations, existingLTM)

	// 5. Call LLM
	try {
		const text = await callLLM(config, CONSOLIDATION_SYSTEM, userMessage, log)
		if (!text) return empty

		// 6. Parse response
		const parsed = parseConsolidationResponse(text, log)
		if (!parsed) return empty

		// 7. Store new LTM entries
		const newMemories: CreateLTMInput[] = []

		for (const entry of parsed.episodic) {
			const input = toLTMInput("episodic", entry, sessionId)
			newMemories.push(input)
			insertLTM(db, input)
		}
		for (const entry of parsed.semantic) {
			const input = toLTMInput("semantic", entry, sessionId)
			newMemories.push(input)
			insertLTM(db, input)
		}
		for (const entry of parsed.procedural) {
			const input = toLTMInput("procedural", entry, sessionId)
			newMemories.push(input)
			insertLTM(db, input)
		}

		// 8. Mark session as consolidated
		markConsolidated(db, sessionId)

		log("info", `[memory:consolidate] Created ${newMemories.length} LTM entries`)

		return { newMemories }
	} catch (err) {
		log("warn", `[memory:consolidate] Failed: ${err}`)
		return empty
	}
}

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildUserMessage(observations: Observation[], existingLTM: LTMEntry[]): string {
	const parts: string[] = []

	// Existing LTM section (for dedup)
	if (existingLTM.length > 0) {
		parts.push("EXISTING_LTM (do NOT duplicate — skip facts that already exist):")
		for (const ltm of existingLTM.slice(0, 50)) {
			parts.push(`  [id=${ltm.id}] [${ltm.type}] ${ltm.content}`)
		}
		parts.push("")
	}

	// Session observations
	parts.push(`SESSION OBSERVATIONS (${observations.length} total):`)
	parts.push("")
	for (const obs of observations.slice(0, 80)) {
		const files = [...obs.filesRead, ...obs.filesModified]
		const filePart = files.length > 0 ? ` | Files: ${files.join(", ")}` : ""
		const factsPart = obs.facts.length > 0 ? ` | Facts: ${obs.facts.join("; ")}` : ""
		parts.push(`  [#${obs.id}] [${obs.type}] ${obs.title} — ${obs.narrative}${filePart}${factsPart}`)
	}

	return parts.join("\n").slice(0, 12000)
}

// ─── Response Parser ─────────────────────────────────────────────────────────

interface RawConsolidation {
	episodic: RawMemoryEntry[]
	semantic: RawMemoryEntry[]
	procedural: RawMemoryEntry[]
}

interface RawMemoryEntry {
	content: string
	caption?: string
	context?: string
	tags?: string[]
	files?: string[]
	source_observation_ids?: number[]
}

function parseConsolidationResponse(text: string, log: LogFn): RawConsolidation | null {
	try {
		const json = extractJson(text)
		const parsed = JSON.parse(json)

		return {
			episodic: Array.isArray(parsed.episodic) ? parsed.episodic.filter(validEntry) : [],
			semantic: Array.isArray(parsed.semantic) ? parsed.semantic.filter(validEntry) : [],
			procedural: Array.isArray(parsed.procedural) ? parsed.procedural.filter(validEntry) : [],
		}
	} catch (err) {
		log("warn", `[memory:consolidate] Failed to parse JSON: ${err}`)
		return null
	}
}

function validEntry(entry: unknown): entry is RawMemoryEntry {
	if (!entry || typeof entry !== "object") return false
	const e = entry as Record<string, unknown>
	return typeof e.content === "string" && e.content.length > 0
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toLTMInput(
	type: CreateLTMInput["type"],
	entry: RawMemoryEntry,
	sessionId: string,
): CreateLTMInput {
	return {
		type,
		content: entry.content,
		caption: entry.caption ?? entry.content.slice(0, 80),
		context: entry.context ?? null,
		sourceSessionId: sessionId,
		sourceObservationIds: entry.source_observation_ids ?? [],
		tags: entry.tags ?? [],
		files: entry.files ?? [],
	}
}
