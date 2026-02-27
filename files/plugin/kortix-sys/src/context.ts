/**
 * Memory Context Formatter
 *
 * Generates a compact <memory-context> markdown table injected as a
 * synthetic user message at position 1 (cache-safe — system prompt untouched).
 *
 * Shows recent observations as a compact index with ID, session, type, and title.
 * The agent uses observation_search / ltm_search / get_mem to retrieve full details.
 */

import type { Database } from "bun:sqlite"
import { getRecentObservations } from "./db"
import type { ObservationType } from "./types"

// ─── Configuration ───────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 50

const TYPE_EMOJI: Record<string, string> = {
	discovery: "🔵",
	decision: "⚖️",
	bugfix: "🔴",
	feature: "🟣",
	refactor: "🔄",
	change: "✅",
}

// ─── Main Formatter ──────────────────────────────────────────────────────────

/**
 * Generate the compact observation reference table for injection.
 * Returns empty string if no observations exist.
 *
 * Entries sorted by recency (created_at DESC), displayed as a markdown table.
 */
export function generateContextBlock(
	db: Database,
	limit?: number,
): string {
	const entries = getRecentObservations(db, limit ?? DEFAULT_LIMIT)
	if (entries.length === 0) return ""

	const lines: string[] = [
		"<memory-context>",
		"Recent observations (most recent first). Use observation_search/ltm_search/get_mem for details.",
		"",
		"| ID | Session | T | Title |",
		"|----|---------|---|-------|",
	]

	for (const e of entries) {
		const title = e.title.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 80)
		const emoji = TYPE_EMOJI[e.type] ?? "❓"
		const session = e.sessionId ? e.sessionId.slice(0, 12) : "—"
		lines.push(`| #${e.id} | ${session} | ${emoji} | ${title} |`)
	}

	lines.push("")
	lines.push("</memory-context>")

	return lines.join("\n")
}
