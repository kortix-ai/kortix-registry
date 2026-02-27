/**
 * Hybrid Search Engine (referenced by Openclaw docs)
 *
 * Combines BM25 (FTS5) and vector (LSS HTTP API) results with
 * weighted score fusion and temporal decay.
 *
 * Algorithm:
 *   1. Retrieve candidate pools from both BM25 and LSS (limit * multiplier)
 *   2. Normalize BM25 ranks (negative FTS5 values) to 0..1 via min-max
 *   3. Union candidates by ID, compute weighted score + temporal decay
 *   4. Sort by final score, return top N
 *
 * Graceful degradation:
 *   - LSS unavailable → BM25 only
 *   - FTS5 parse error → vector only
 *   - Both fail → empty results
 */

import type { Database } from "bun:sqlite"
import {
	searchObservationsFtsRanked,
	searchLTMFtsRanked,
} from "./db"
import type { LogFn } from "./types"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RankedResult {
	id: number
	source: "observation" | "ltm"
	finalScore: number
}

interface LSSHit {
	file_path: string
	score: number
	snippet: string
	rank_stage: string
	indexed_at: string
}

interface ParsedLSSHit {
	source: "observation" | "ltm"
	id: number
	score: number
}

interface CandidateInfo {
	createdAt: string
	bm25Score: number
	vectorScore: number
}

// ─── Configuration ───────────────────────────────────────────────────────────

const VECTOR_WEIGHT = 0.5
const TEXT_WEIGHT = 0.5
const HALF_LIFE_DAYS = 30
const CANDIDATE_MULTIPLIER = 3
const LSS_TIMEOUT_MS = 5000
const LSS_MEM_PATH = "/workspace/.lss/kortix-mem"

let lssBaseUrl = "http://localhost:8000/lss"
let log: LogFn = () => {}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialize the search module. Call once at startup.
 */
export function initSearch(logFn: LogFn, lssUrl?: string): void {
	log = logFn
	if (lssUrl) lssBaseUrl = lssUrl
}

/**
 * Hybrid search across long-term memories.
 */
export async function hybridSearchLTM(
	db: Database,
	query: string,
	opts?: { limit?: number; type?: string; tags?: string[] },
): Promise<RankedResult[]> {
	const limit = opts?.limit ?? 10
	const fetchLimit = limit * CANDIDATE_MULTIPLIER

	// BM25 leg
	const bm25Raw = searchLTMFtsRanked(db, query, {
		limit: fetchLimit,
		type: opts?.type,
	})
	const bm25Map = normalizeBM25(bm25Raw)

	// Vector leg (scoped to ltm files)
	const lssHits = await fetchLSSResults(query, fetchLimit)
	const vectorMap = new Map<number, { score: number; createdAt: string }>()
	for (const hit of lssHits) {
		if (hit.source !== "ltm") continue
		vectorMap.set(hit.id, { score: hit.score, createdAt: "" })
	}

	// Merge and rank
	return mergeAndRank(bm25Map, vectorMap, "ltm", limit)
}

/**
 * Hybrid search across observations.
 */
export async function hybridSearchObservations(
	db: Database,
	query: string,
	opts?: {
		limit?: number
		type?: string
		concepts?: string[]
		toolName?: string
		sessionId?: string
	},
): Promise<RankedResult[]> {
	const limit = opts?.limit ?? 10
	const fetchLimit = limit * CANDIDATE_MULTIPLIER

	// BM25 leg
	const bm25Raw = searchObservationsFtsRanked(db, query, {
		limit: fetchLimit,
		type: opts?.type,
		sessionId: opts?.sessionId,
		toolName: opts?.toolName,
		concepts: opts?.concepts,
	})
	const bm25Map = normalizeBM25(bm25Raw)

	// Vector leg (scoped to obs files)
	const lssHits = await fetchLSSResults(query, fetchLimit)
	const vectorMap = new Map<number, { score: number; createdAt: string }>()
	for (const hit of lssHits) {
		if (hit.source !== "observation") continue
		vectorMap.set(hit.id, { score: hit.score, createdAt: "" })
	}

	// Merge and rank
	return mergeAndRank(bm25Map, vectorMap, "observation", limit)
}

// ─── LSS HTTP Client ─────────────────────────────────────────────────────────

async function fetchLSSResults(
	query: string,
	limit: number,
): Promise<ParsedLSSHit[]> {
	try {
		const url = `${lssBaseUrl}/search?q=${encodeURIComponent(query)}&k=${limit}&path=${encodeURIComponent(LSS_MEM_PATH)}&ext=.md`
		const resp = await fetch(url, {
			signal: AbortSignal.timeout(LSS_TIMEOUT_MS),
		})
		if (!resp.ok) return []

		const data = await resp.json() as Array<{ query: string; hits: LSSHit[] }>
		if (!Array.isArray(data) || data.length === 0) return []

		const results: ParsedLSSHit[] = []
		for (const hit of data[0].hits) {
			const parsed = parseLSSFilePath(hit.file_path)
			if (parsed) {
				results.push({ ...parsed, score: hit.score })
			}
		}
		return results
	} catch {
		log("debug", `[memory:search] LSS unavailable, falling back to BM25 only`)
		return []
	}
}

/**
 * Extract source type and ID from LSS file paths.
 * - obs_{id}.md → { source: "observation", id }
 * - ltm_{type}_{id}.md → { source: "ltm", id }
 */
function parseLSSFilePath(filePath: string): { source: "observation" | "ltm"; id: number } | null {
	const filename = filePath.split("/").pop() ?? ""

	// obs_{id}.md
	const obsMatch = filename.match(/^obs_(\d+)\.md$/)
	if (obsMatch) {
		return { source: "observation", id: parseInt(obsMatch[1], 10) }
	}

	// ltm_{type}_{id}.md
	const ltmMatch = filename.match(/^ltm_\w+_(\d+)\.md$/)
	if (ltmMatch) {
		return { source: "ltm", id: parseInt(ltmMatch[1], 10) }
	}

	return null
}

// ─── Score Normalization ─────────────────────────────────────────────────────

/**
 * Normalize negative FTS5 ranks to 0..1 via min-max within the candidate pool.
 * More negative rank = more relevant → higher normalized score.
 */
function normalizeBM25(
	rows: Array<{ id: number; rank: number; createdAt: string }>,
): Map<number, { score: number; createdAt: string }> {
	const map = new Map<number, { score: number; createdAt: string }>()
	if (rows.length === 0) return map

	// Negate ranks: FTS5 rank is negative, more negative = better
	const positives = rows.map(r => -r.rank)
	const min = Math.min(...positives)
	const max = Math.max(...positives)
	const range = max - min

	for (let i = 0; i < rows.length; i++) {
		const normalized = range > 0
			? (positives[i] - min) / range
			: 1.0  // single result gets max score
		map.set(rows[i].id, {
			score: normalized,
			createdAt: rows[i].createdAt,
		})
	}

	return map
}

/**
 * Temporal decay: exponential decay based on age in days.
 * Returns 1.0 for brand new, ~0.5 at halfLifeDays, approaches 0 over time.
 */
function temporalDecay(createdAt: string): number {
	if (!createdAt) return 1.0
	const ageDays = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)
	if (ageDays <= 0) return 1.0
	return Math.exp(-ageDays / HALF_LIFE_DAYS)
}

// ─── Merge & Rank ────────────────────────────────────────────────────────────

function mergeAndRank(
	bm25Map: Map<number, { score: number; createdAt: string }>,
	vectorMap: Map<number, { score: number; createdAt: string }>,
	source: "observation" | "ltm",
	limit: number,
): RankedResult[] {
	// Union all candidate IDs
	const allIds = new Set([...bm25Map.keys(), ...vectorMap.keys()])
	const results: RankedResult[] = []

	for (const id of allIds) {
		const bm25 = bm25Map.get(id)
		const vector = vectorMap.get(id)

		const textScore = bm25?.score ?? 0
		const vectorScore = vector?.score ?? 0
		const createdAt = bm25?.createdAt || vector?.createdAt || ""

		const rawScore = TEXT_WEIGHT * textScore + VECTOR_WEIGHT * vectorScore
		const decay = temporalDecay(createdAt)
		const finalScore = rawScore * decay

		results.push({ id, source, finalScore })
	}

	// Sort descending by final score
	results.sort((a, b) => b.finalScore - a.finalScore)

	return results.slice(0, limit)
}
