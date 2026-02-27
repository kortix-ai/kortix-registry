/**
 * AI Observation Enrichment
 *
 * After deterministic extraction inserts a basic observation,
 * this module enriches it with AI-generated semantic content:
 *   - Better title, narrative, facts, concepts, type classification
 *
 * Runs as a fire-and-forget serial queue — never blocks the tool execution pipeline.
 * If no LLM provider is available or the call fails, the deterministic observation stands.
 */

import type { Database } from "bun:sqlite"
import { resolveLLMConfig, callLLM, extractJson, type LLMOptions } from "./llm"
import { updateObservationEnrichment } from "./db"
import type { LogFn } from "./types"

// ─── Configuration ───────────────────────────────────────────────────────────

const ENRICHMENT_MAX_TOKENS = 500

const ENRICHMENT_SYSTEM = `You analyze a single tool execution and extract a structured observation for an autonomous coding agent's memory system.

Given the tool name, arguments, and output, return JSON with enriched fields:

{
  "type": "discovery|change|bugfix|feature|refactor|decision",
  "title": "Short descriptive title (max 80 chars)",
  "narrative": "1-2 sentence summary of what happened and what was learned",
  "facts": ["specific extracted detail 1", "specific detail 2"],
  "concepts": ["concept1", "concept2", "concept3"]
}

Rules:
- title: what was done, concisely. E.g. "Configured Redis caching in config.ts", not "Read config.ts"
- narrative: what was LEARNED or CHANGED — extract actual insights from the output, don't just restate the tool name
- facts: specific details extracted from the output (config values, function signatures, error messages, patterns, key findings). Max 5.
- concepts: searchable semantic tags — technologies, patterns, architectural domains, libraries. Max 8.
- type: classify accurately — "discovery" for learning, "change" for modifications, "bugfix" for fixes, "feature" for new code, "refactor" for restructuring, "decision" for architectural choices
- If the tool output contains nothing meaningful (empty output, trivial confirmation), return: {"skip": true}
- Output ONLY valid JSON. No markdown fences, no commentary.`

// ─── State ───────────────────────────────────────────────────────────────────

interface EnrichmentItem {
	obsId: number
	toolName: string
	args: Record<string, unknown>
	rawOutput: string
}

interface EnrichedFields {
	type?: string
	title?: string
	narrative?: string
	facts?: string[]
	concepts?: string[]
}

let db: Database | null = null
let log: LogFn = () => {}
let currentOpts: LLMOptions = {}

const queue: EnrichmentItem[] = []
let processing = false

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialize the enrichment module with dependencies.
 * Must be called once at plugin startup.
 */
export function initEnrichment(
	database: Database,
	logFn: LogFn,
	opts?: LLMOptions,
): void {
	db = database
	log = logFn
	if (opts) currentOpts = opts
}

/**
 * Update the LLM options (e.g., when the user changes model in the dashboard).
 */
export function updateEnrichmentOpts(opts: LLMOptions): void {
	currentOpts = { ...currentOpts, ...opts }
}

/**
 * Enqueue an observation for AI enrichment.
 * Non-blocking — returns immediately, enrichment happens in the background.
 */
export function enqueueEnrichment(item: EnrichmentItem): void {
	// Skip if output is empty or too short to be meaningful
	if (!item.rawOutput || item.rawOutput.length < 20) return

	queue.push(item)

	// Kick off processing if not already running
	if (!processing) {
		processQueue().catch((err) => {
			log("warn", `[memory:enrich] Queue processing failed: ${err}`)
			processing = false
		})
	}
}

// ─── Internal ────────────────────────────────────────────────────────────────

async function processQueue(): Promise<void> {
	if (processing) return
	processing = true

	while (queue.length > 0) {
		const item = queue.shift()!
		try {
			const enriched = await enrichSingle(item)
			if (enriched && db) {
				updateObservationEnrichment(db, item.obsId, enriched)
				log("debug", `[memory:enrich] Enriched observation #${item.obsId}: "${enriched.title?.slice(0, 50)}"`)
			}
		} catch (err) {
			log("warn", `[memory:enrich] Failed to enrich observation #${item.obsId}: ${err}`)
		}
	}

	processing = false
}

async function enrichSingle(item: EnrichmentItem): Promise<EnrichedFields | null> {
	const config = resolveLLMConfig(currentOpts)
	if (!config) return null

	// Build the user message with tool context
	const argStr = formatArgs(item.args)
	const userMessage = [
		`Tool: ${item.toolName}`,
		argStr ? `Arguments: ${argStr}` : null,
		`Output:`,
		item.rawOutput,
	].filter(Boolean).join("\n")

	const text = await callLLM(config, ENRICHMENT_SYSTEM, userMessage, log, ENRICHMENT_MAX_TOKENS)
	if (!text) return null

	return parseEnrichmentResponse(text)
}

function parseEnrichmentResponse(text: string): EnrichedFields | null {
	try {
		const json = extractJson(text)
		const parsed = JSON.parse(json)

		// Check for skip signal
		if (parsed.skip === true) return null

		const result: EnrichedFields = {}

		if (typeof parsed.type === "string" && parsed.type.length > 0) {
			const validTypes = new Set(["discovery", "decision", "bugfix", "feature", "refactor", "change"])
			if (validTypes.has(parsed.type)) result.type = parsed.type
		}
		if (typeof parsed.title === "string" && parsed.title.length > 0) {
			result.title = parsed.title.slice(0, 120)
		}
		if (typeof parsed.narrative === "string" && parsed.narrative.length > 0) {
			result.narrative = parsed.narrative.slice(0, 500)
		}
		if (Array.isArray(parsed.facts)) {
			result.facts = parsed.facts
				.filter((f: unknown) => typeof f === "string" && f.length > 0)
				.slice(0, 5)
		}
		if (Array.isArray(parsed.concepts)) {
			result.concepts = parsed.concepts
				.filter((c: unknown) => typeof c === "string" && c.length > 0)
				.slice(0, 8)
		}

		// Only return if we got at least one meaningful field
		if (Object.keys(result).length === 0) return null

		return result
	} catch {
		return null
	}
}

function formatArgs(args: Record<string, unknown>): string {
	const parts: string[] = []
	for (const [k, v] of Object.entries(args)) {
		if (typeof v === "string") {
			parts.push(`${k}: ${v.slice(0, 200)}`)
		} else if (v != null) {
			parts.push(`${k}: ${String(v).slice(0, 100)}`)
		}
	}
	return parts.join(", ").slice(0, 500)
}
