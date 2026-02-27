/**
 * Shared Types for Kortix Memory Plugin
 */

// ─── Observation Types (Short-Term Memory) ───────────────────────────────────

export type ObservationType =
	| "discovery"
	| "decision"
	| "bugfix"
	| "feature"
	| "refactor"
	| "change"

export interface Observation {
	id: number
	sessionId: string
	type: ObservationType
	title: string
	narrative: string
	facts: string[]
	concepts: string[]
	filesRead: string[]
	filesModified: string[]
	toolName: string
	promptNumber: number | null
	createdAt: string
}

export interface CreateObservationInput {
	sessionId: string
	type: ObservationType
	title: string
	narrative: string
	facts: string[]
	concepts: string[]
	filesRead: string[]
	filesModified: string[]
	toolName: string
	promptNumber: number | null
}

// ─── Long-Term Memory Types ──────────────────────────────────────────────────

export type LTMType = "episodic" | "semantic" | "procedural"

export interface LTMEntry {
	id: number
	type: LTMType
	content: string
	caption: string | null
	context: string | null
	sourceSessionId: string | null
	sourceObservationIds: number[]
	tags: string[]
	files: string[]
	createdAt: string
	updatedAt: string
}

export interface CreateLTMInput {
	type: LTMType
	content: string
	caption?: string | null
	context?: string | null
	sourceSessionId?: string | null
	sourceObservationIds?: number[]
	tags?: string[]
	files?: string[]
}

// ─── Search Types ────────────────────────────────────────────────────────────

export interface SearchHit {
	id: number
	source: "observation" | "ltm"
	type: ObservationType | LTMType
	title: string           // observation title or LTM content (truncated)
	content: string         // narrative or LTM content
	tags: string[]
	files: string[]
	createdAt: string
	rank?: number           // FTS5 rank
}

export interface SearchOptions {
	limit?: number
	type?: string
	sessionId?: string
	source?: "observation" | "ltm" | "both"
}

// ─── Session Types ───────────────────────────────────────────────────────────

export interface SessionMeta {
	id: string
	promptCount: number
	observationCount: number
	lastConsolidatedAt: string | null
	status: "active" | "completed"
	startedAt: string
	completedAt: string | null
}

// ─── Consolidation Types ─────────────────────────────────────────────────────

export interface ConsolidationResult {
	newMemories: CreateLTMInput[]
}

// ─── Logging ─────────────────────────────────────────────────────────────────

export type LogFn = (level: "debug" | "info" | "warn" | "error", message: string) => void
