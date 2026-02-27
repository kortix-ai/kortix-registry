/**
 * Session tools — cross-session context retrieval with TTC compression.
 *
 * Absorbed from the standalone plugin/session.ts into the memory plugin.
 * Provides session_list and session_get tools.
 */

import { readFileSync } from "node:fs"
import type { Message, Part, Session, ToolPart, ToolStateCompleted, ToolStateError } from "@opencode-ai/sdk"

// ─── Env helper (hot-reload from s6 env dir) ────────────────────────────────

const S6_ENV_DIR = process.env.S6_ENV_DIR || "/run/s6/container_environment"

export function getEnv(key: string): string | undefined {
	const cached = process.env[key]
	if (cached) return cached
	try {
		const val = readFileSync(`${S6_ENV_DIR}/${key}`, "utf-8").trim()
		if (val) {
			process.env[key] = val
			return val
		}
	} catch {
		// not set
	}
	return undefined
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const STORAGE_BASE = "/workspace/.local/share/opencode"
export const DB_PATH = `${STORAGE_BASE}/opencode.db`
const TTC_API_URL = "https://api.thetokencompany.com/v1/compress"
const TTC_MODEL = "bear-1.2"

/** Max chars to keep per tool call input (before TTC) */
const TOOL_INPUT_TRUNC = 200
/** Max chars to keep per tool call output (before TTC) */
const TOOL_OUTPUT_TRUNC = 2000

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Truncate a string keeping head + tail with an omission marker */
export function truncate(str: string, maxLen: number): string {
	if (str.length <= maxLen) return str
	const head = Math.floor(maxLen * 0.4)
	const tail = Math.floor(maxLen * 0.4)
	const omitted = str.length - head - tail
	return `${str.slice(0, head)}...[${omitted} chars omitted]...${str.slice(-tail)}`
}

/** ISO timestamp without seconds, e.g. "2026-02-25 14:30" */
export function shortTs(epochMs: number): string {
	return new Date(epochMs).toISOString().slice(0, 16).replace("T", " ")
}

/** Human-readable file-change summary from session.summary */
export function changeSummary(s: Session): string {
	if (!s.summary) return "no file changes"
	return `${s.summary.files} files (+${s.summary.additions}, -${s.summary.deletions})`
}

// ─── Message formatter ───────────────────────────────────────────────────────

/**
 * Walk messages and produce a plain-text transcript.
 * - User/assistant text: verbatim
 * - Completed tool calls: name + truncated I/O
 * - Errored tool calls: name + error
 * - Everything else: skipped
 */
export function formatMessages(
	messages: Array<{ info: Message; parts: Part[] }>,
): string {
	const lines: string[] = []

	for (const msg of messages) {
		const role = msg.info.role === "user" ? "USER" : "ASSISTANT"

		for (const part of msg.parts) {
			switch (part.type) {
				case "text": {
					if (part.synthetic || part.ignored) break
					lines.push(`${role}: ${part.text}`)
					break
				}
				case "tool": {
					const tp = part as ToolPart
					if (tp.state.status === "completed") {
						const st = tp.state as ToolStateCompleted
						const inp = truncate(JSON.stringify(st.input), TOOL_INPUT_TRUNC)
						const out = truncate(st.output, TOOL_OUTPUT_TRUNC)
						lines.push(`TOOL [${tp.tool}]: ${inp} → ${out}`)
					} else if (tp.state.status === "error") {
						const st = tp.state as ToolStateError
						lines.push(`TOOL [${tp.tool}] ERROR: ${truncate(st.error, 300)}`)
					}
					break
				}
				// Skip: reasoning, file, step-start, step-finish, snapshot, patch, agent, retry, compaction, subtask
			}
		}
	}

	return lines.join("\n\n")
}

// ─── TTC compression ─────────────────────────────────────────────────────────

export interface TtcResult {
	output: string
	originalTokens: number
	compressedTokens: number
}

export async function ttcCompress(
	text: string,
	aggressiveness: number,
	apiKey: string,
): Promise<TtcResult> {
	try {
		const res = await fetch(TTC_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model: TTC_MODEL,
				input: text,
				compression_settings: { aggressiveness },
			}),
		})

		if (!res.ok) {
			const body = await res.text().catch(() => "")
			console.error(`[session] TTC API error ${res.status}: ${body}`)
			return { output: text, originalTokens: 0, compressedTokens: 0 }
		}

		const data = (await res.json()) as {
			output: string
			original_input_tokens: number
			output_tokens: number
		}

		return {
			output: data.output,
			originalTokens: data.original_input_tokens,
			compressedTokens: data.output_tokens,
		}
	} catch (err) {
		console.error(`[session] TTC compression failed: ${err}`)
		return { output: text, originalTokens: 0, compressedTokens: 0 }
	}
}
