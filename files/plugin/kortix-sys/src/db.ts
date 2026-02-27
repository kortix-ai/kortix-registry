/**
 * SQLite Database Layer — Observations + Long-Term Memory
 *
 * Two tables:
 *   observations        — raw tool execution events (short-term)
 *   long_term_memories  — consolidated episodic/semantic/procedural memories
 *
 * Both have FTS5 virtual tables for full-text search.
 * Unified search fans out to both and ranks LTM higher.
 */

import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import * as os from "node:os"
import * as path from "node:path"
import type {
	Observation,
	CreateObservationInput,
	LTMEntry,
	CreateLTMInput,
	SearchHit,
	SearchOptions,
	SessionMeta,
} from "./types"

// ─── Constants ───────────────────────────────────────────────────────────────

// Resolve DB path: use the same storage dir that s6 pre-creates for OpenCode.
// The s6 service creates & chowns /workspace/.local/share/opencode/storage/
// BEFORE switching to user abc, so this dir is guaranteed writable.
const BASE_DIR = process.env.KORTIX_WORKSPACE ?? process.env.HOME ?? os.homedir()
const DEFAULT_DB_PATH = path.join(BASE_DIR, ".local", "share", "opencode", "storage", "kortix-memory.db")

// ─── Init ────────────────────────────────────────────────────────────────────

/**
 * Initialize the SQLite database with all tables, indexes, and FTS5.
 * @param dbPath - Override path for testing. Defaults to ~/.kortix/memory.db
 */
export function initDb(dbPath?: string): Database {
	const p = dbPath ?? DEFAULT_DB_PATH
	mkdirSync(dirname(p), { recursive: true })

	const db = new Database(p)
	db.exec("PRAGMA journal_mode=WAL")
	db.exec("PRAGMA busy_timeout=5000")

	// ── Observations table ────────────────────────────────────────────
	db.exec(`
		CREATE TABLE IF NOT EXISTS observations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL,
			type TEXT NOT NULL,
			title TEXT NOT NULL,
			narrative TEXT NOT NULL DEFAULT '',
			facts TEXT NOT NULL DEFAULT '[]',
			concepts TEXT NOT NULL DEFAULT '[]',
			files_read TEXT NOT NULL DEFAULT '[]',
			files_modified TEXT NOT NULL DEFAULT '[]',
			tool_name TEXT NOT NULL,
			prompt_number INTEGER,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`)

	db.exec(`CREATE INDEX IF NOT EXISTS idx_obs_session ON observations(session_id)`)
	db.exec(`CREATE INDEX IF NOT EXISTS idx_obs_type ON observations(type)`)
	db.exec(`CREATE INDEX IF NOT EXISTS idx_obs_created ON observations(created_at DESC)`)

	// Observations FTS5
	db.exec(`
		CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
			title, narrative, facts, concepts,
			content=observations, content_rowid=id
		)
	`)

	db.exec(`
		CREATE TRIGGER IF NOT EXISTS obs_fts_insert AFTER INSERT ON observations BEGIN
			INSERT INTO observations_fts(rowid, title, narrative, facts, concepts)
			VALUES (new.id, new.title, new.narrative, new.facts, new.concepts);
		END
	`)
	db.exec(`
		CREATE TRIGGER IF NOT EXISTS obs_fts_delete AFTER DELETE ON observations BEGIN
			INSERT INTO observations_fts(observations_fts, rowid, title, narrative, facts, concepts)
			VALUES ('delete', old.id, old.title, old.narrative, old.facts, old.concepts);
		END
	`)
	db.exec(`
		CREATE TRIGGER IF NOT EXISTS obs_fts_update AFTER UPDATE ON observations BEGIN
			INSERT INTO observations_fts(observations_fts, rowid, title, narrative, facts, concepts)
			VALUES ('delete', old.id, old.title, old.narrative, old.facts, old.concepts);
			INSERT INTO observations_fts(rowid, title, narrative, facts, concepts)
			VALUES (new.id, new.title, new.narrative, new.facts, new.concepts);
		END
	`)

	// ── Long-Term Memories table ──────────────────────────────────────
	db.exec(`
		CREATE TABLE IF NOT EXISTS long_term_memories (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			type TEXT NOT NULL,
			content TEXT NOT NULL,
			context TEXT,
			source_session_id TEXT,
			source_observation_ids TEXT NOT NULL DEFAULT '[]',
			tags TEXT NOT NULL DEFAULT '[]',
			files TEXT NOT NULL DEFAULT '[]',
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`)

	// Migration: add caption column if missing (existing DBs won't have it)
	try {
		db.exec(`ALTER TABLE long_term_memories ADD COLUMN caption TEXT`)
	} catch {
		// Column already exists — ignore
	}

	db.exec(`CREATE INDEX IF NOT EXISTS idx_ltm_type ON long_term_memories(type)`)
	db.exec(`CREATE INDEX IF NOT EXISTS idx_ltm_created ON long_term_memories(created_at DESC)`)

	// LTM FTS5
	db.exec(`
		CREATE VIRTUAL TABLE IF NOT EXISTS ltm_fts USING fts5(
			content, context, tags,
			content=long_term_memories, content_rowid=id
		)
	`)

	db.exec(`
		CREATE TRIGGER IF NOT EXISTS ltm_fts_insert AFTER INSERT ON long_term_memories BEGIN
			INSERT INTO ltm_fts(rowid, content, context, tags)
			VALUES (new.id, new.content, new.context, new.tags);
		END
	`)
	db.exec(`
		CREATE TRIGGER IF NOT EXISTS ltm_fts_delete AFTER DELETE ON long_term_memories BEGIN
			INSERT INTO ltm_fts(ltm_fts, rowid, content, context, tags)
			VALUES ('delete', old.id, old.content, old.context, old.tags);
		END
	`)
	db.exec(`
		CREATE TRIGGER IF NOT EXISTS ltm_fts_update AFTER UPDATE ON long_term_memories BEGIN
			INSERT INTO ltm_fts(ltm_fts, rowid, content, context, tags)
			VALUES ('delete', old.id, old.content, old.context, old.tags);
			INSERT INTO ltm_fts(rowid, content, context, tags)
			VALUES (new.id, new.content, new.context, new.tags);
		END
	`)

	// ── Session Meta table ────────────────────────────────────────────
	db.exec(`
		CREATE TABLE IF NOT EXISTS session_meta (
			id TEXT PRIMARY KEY,
			prompt_count INTEGER NOT NULL DEFAULT 0,
			observation_count INTEGER NOT NULL DEFAULT 0,
			last_consolidated_at TEXT,
			status TEXT NOT NULL DEFAULT 'active',
			started_at TEXT NOT NULL DEFAULT (datetime('now')),
			completed_at TEXT
		)
	`)

	return db
}

// ═════════════════════════════════════════════════════════════════════════════
// OBSERVATION CRUD
// ═════════════════════════════════════════════════════════════════════════════

export function insertObservation(db: Database, input: CreateObservationInput): number {
	const result = db.run(
		`INSERT INTO observations (session_id, type, title, narrative, facts, concepts, files_read, files_modified, tool_name, prompt_number)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			input.sessionId,
			input.type,
			input.title,
			input.narrative,
			JSON.stringify(input.facts),
			JSON.stringify(input.concepts),
			JSON.stringify(input.filesRead),
			JSON.stringify(input.filesModified),
			input.toolName,
			input.promptNumber,
		],
	)

	// Update observation count on session meta
	db.run(
		`UPDATE session_meta SET observation_count = observation_count + 1 WHERE id = ?`,
		[input.sessionId],
	)

	return Number(result.lastInsertRowid)
}

export function getRecentObservations(db: Database, limit = 30): Observation[] {
	const rows = db.query(
		`SELECT * FROM observations ORDER BY created_at DESC, id DESC LIMIT ?`,
	).all(limit) as Record<string, unknown>[]
	return rows.map(rowToObservation)
}

export function getObservationsBySession(db: Database, sessionId: string): Observation[] {
	const rows = db.query(
		`SELECT * FROM observations WHERE session_id = ? ORDER BY id ASC`,
	).all(sessionId) as Record<string, unknown>[]
	return rows.map(rowToObservation)
}

export function getObservationsByIds(db: Database, ids: number[]): Observation[] {
	if (ids.length === 0) return []
	const placeholders = ids.map(() => "?").join(",")
	const rows = db.query(
		`SELECT * FROM observations WHERE id IN (${placeholders}) ORDER BY id ASC`,
	).all(...ids) as Record<string, unknown>[]
	return rows.map(rowToObservation)
}

// ═════════════════════════════════════════════════════════════════════════════
// OBSERVATION FTS5 SEARCH
// ═════════════════════════════════════════════════════════════════════════════

export function searchObservationsFts(
	db: Database,
	query: string,
	opts?: { limit?: number; type?: string; sessionId?: string },
): Observation[] {
	const limit = Math.min(opts?.limit ?? 20, 100)

	// Try FTS5 first
	try {
		const ftsQuery = escapeFts5(query)
		let sql = `
			SELECT o.*, fts.rank
			FROM observations_fts fts
			JOIN observations o ON o.id = fts.rowid
			WHERE observations_fts MATCH ?
		`
		const params: (string | number)[] = [ftsQuery]

		if (opts?.type) {
			sql += ` AND o.type = ?`
			params.push(opts.type)
		}
		if (opts?.sessionId) {
			sql += ` AND o.session_id = ?`
			params.push(opts.sessionId)
		}

		sql += ` ORDER BY fts.rank LIMIT ?`
		params.push(limit)

		const rows = db.query(sql).all(...params) as Record<string, unknown>[]
		if (rows.length > 0) {
			return rows.map(rowToObservation)
		}
	} catch {
		// FTS5 query parse error — fall through to LIKE
	}

	// LIKE fallback
	return searchObservationsLike(db, query, limit, opts)
}

function searchObservationsLike(
	db: Database,
	query: string,
	limit: number,
	opts?: { type?: string; sessionId?: string },
): Observation[] {
	const words = query.split(/\s+/).filter(Boolean)
	if (words.length === 0) return []

	const conditions = words
		.map(() => `(title LIKE ? OR narrative LIKE ? OR facts LIKE ? OR concepts LIKE ?)`)
		.join(" AND ")
	const params: (string | number)[] = []
	for (const w of words) {
		const like = `%${w}%`
		params.push(like, like, like, like)
	}

	let sql = `SELECT * FROM observations WHERE ${conditions}`
	if (opts?.type) {
		sql += ` AND type = ?`
		params.push(opts.type)
	}
	if (opts?.sessionId) {
		sql += ` AND session_id = ?`
		params.push(opts.sessionId)
	}
	sql += ` ORDER BY created_at DESC LIMIT ?`
	params.push(limit)

	const rows = db.query(sql).all(...params) as Record<string, unknown>[]
	return rows.map(rowToObservation)
}

// ═════════════════════════════════════════════════════════════════════════════
// LTM CRUD
// ═════════════════════════════════════════════════════════════════════════════

export function insertLTM(db: Database, input: CreateLTMInput): number {
	const result = db.run(
		`INSERT INTO long_term_memories (type, content, caption, context, source_session_id, source_observation_ids, tags, files)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			input.type,
			input.content,
			input.caption ?? null,
			input.context ?? null,
			input.sourceSessionId ?? null,
			JSON.stringify(input.sourceObservationIds ?? []),
			JSON.stringify(input.tags ?? []),
			JSON.stringify(input.files ?? []),
		],
	)
	return Number(result.lastInsertRowid)
}

export function getRecentLTM(db: Database, limit = 30): LTMEntry[] {
	const rows = db.query(
		`SELECT * FROM long_term_memories ORDER BY updated_at DESC, id DESC LIMIT ?`,
	).all(limit) as Record<string, unknown>[]
	return rows.map(rowToLTM)
}

export function getLTMByType(db: Database, type: string, limit = 20): LTMEntry[] {
	const rows = db.query(
		`SELECT * FROM long_term_memories WHERE type = ? ORDER BY updated_at DESC, id DESC LIMIT ?`,
	).all(type, limit) as Record<string, unknown>[]
	return rows.map(rowToLTM)
}

export function getAllLTM(db: Database): LTMEntry[] {
	const rows = db.query(
		`SELECT * FROM long_term_memories ORDER BY type, updated_at DESC, id DESC`,
	).all() as Record<string, unknown>[]
	return rows.map(rowToLTM)
}

// ═════════════════════════════════════════════════════════════════════════════
// LTM FTS5 SEARCH
// ═════════════════════════════════════════════════════════════════════════════

export function searchLTMFts(
	db: Database,
	query: string,
	opts?: { limit?: number; type?: string },
): LTMEntry[] {
	const limit = Math.min(opts?.limit ?? 20, 100)

	try {
		const ftsQuery = escapeFts5(query)
		let sql = `
			SELECT l.*, fts.rank
			FROM ltm_fts fts
			JOIN long_term_memories l ON l.id = fts.rowid
			WHERE ltm_fts MATCH ?
		`
		const params: (string | number)[] = [ftsQuery]

		if (opts?.type) {
			sql += ` AND l.type = ?`
			params.push(opts.type)
		}

		sql += ` ORDER BY fts.rank LIMIT ?`
		params.push(limit)

		const rows = db.query(sql).all(...params) as Record<string, unknown>[]
		if (rows.length > 0) {
			return rows.map(rowToLTM)
		}
	} catch {
		// FTS5 parse error — fall through to LIKE
	}

	// LIKE fallback
	return searchLTMLike(db, query, limit, opts)
}

function searchLTMLike(
	db: Database,
	query: string,
	limit: number,
	opts?: { type?: string },
): LTMEntry[] {
	const words = query.split(/\s+/).filter(Boolean)
	if (words.length === 0) return []

	const conditions = words
		.map(() => `(content LIKE ? OR context LIKE ? OR tags LIKE ?)`)
		.join(" AND ")
	const params: (string | number)[] = []
	for (const w of words) {
		const like = `%${w}%`
		params.push(like, like, like)
	}

	let sql = `SELECT * FROM long_term_memories WHERE ${conditions}`
	if (opts?.type) {
		sql += ` AND type = ?`
		params.push(opts.type)
	}
	sql += ` ORDER BY updated_at DESC LIMIT ?`
	params.push(limit)

	const rows = db.query(sql).all(...params) as Record<string, unknown>[]
	return rows.map(rowToLTM)
}

// ═════════════════════════════════════════════════════════════════════════════
// UNIFIED SEARCH
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Search both observations and LTM, returning unified results.
 * LTM results are ranked higher than observations.
 */
export function unifiedSearch(
	db: Database,
	query: string,
	opts?: SearchOptions,
): SearchHit[] {
	const limit = Math.min(opts?.limit ?? 20, 100)
	const source = opts?.source ?? "both"
	const results: SearchHit[] = []

	// Search LTM first (higher priority)
	if (source === "both" || source === "ltm") {
		const ltmResults = searchLTMFts(db, query, { limit, type: opts?.type })
		for (const entry of ltmResults) {
			results.push({
				id: entry.id,
				source: "ltm",
				type: entry.type,
				title: entry.content.slice(0, 100),
				content: entry.content,
				tags: entry.tags,
				files: entry.files,
				createdAt: entry.createdAt,
			})
		}
	}

	// Search observations
	if (source === "both" || source === "observation") {
		const obsResults = searchObservationsFts(db, query, {
			limit,
			type: opts?.type,
			sessionId: opts?.sessionId,
		})
		for (const obs of obsResults) {
			results.push({
				id: obs.id,
				source: "observation",
				type: obs.type,
				title: obs.title,
				content: obs.narrative,
				tags: obs.concepts,
				files: [...obs.filesRead, ...obs.filesModified],
				createdAt: obs.createdAt,
			})
		}
	}

	// LTM first, then observations. Truncate to limit.
	return results.slice(0, limit)
}

// ═════════════════════════════════════════════════════════════════════════════
// RANKED FTS SEARCH (for hybrid search engine)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Return observation candidates with raw FTS5 rank for score normalization.
 * Supports additional filters: toolName, concepts (LIKE on JSON column).
 */
export function searchObservationsFtsRanked(
	db: Database,
	query: string,
	opts?: {
		limit?: number
		type?: string
		sessionId?: string
		toolName?: string
		concepts?: string[]
	},
): Array<{ id: number; rank: number; createdAt: string }> {
	const limit = Math.min(opts?.limit ?? 60, 200)
	try {
		const ftsQuery = escapeFts5(query)
		let sql = `
			SELECT o.id, fts.rank, o.created_at
			FROM observations_fts fts
			JOIN observations o ON o.id = fts.rowid
			WHERE observations_fts MATCH ?
		`
		const params: (string | number)[] = [ftsQuery]

		if (opts?.type) { sql += ` AND o.type = ?`; params.push(opts.type) }
		if (opts?.sessionId) { sql += ` AND o.session_id = ?`; params.push(opts.sessionId) }
		if (opts?.toolName) { sql += ` AND o.tool_name = ?`; params.push(opts.toolName) }
		if (opts?.concepts?.length) {
			const clauses = opts.concepts.map(() => `o.concepts LIKE ?`)
			sql += ` AND (${clauses.join(" OR ")})`
			for (const c of opts.concepts) params.push(`%${c}%`)
		}

		sql += ` ORDER BY fts.rank LIMIT ?`
		params.push(limit)

		const rows = db.query(sql).all(...params) as Record<string, unknown>[]
		return rows.map(r => ({
			id: r.id as number,
			rank: r.rank as number,
			createdAt: r.created_at as string,
		}))
	} catch {
		return []
	}
}

/**
 * Return LTM candidates with raw FTS5 rank for score normalization.
 */
export function searchLTMFtsRanked(
	db: Database,
	query: string,
	opts?: { limit?: number; type?: string },
): Array<{ id: number; rank: number; createdAt: string }> {
	const limit = Math.min(opts?.limit ?? 60, 200)
	try {
		const ftsQuery = escapeFts5(query)
		let sql = `
			SELECT l.id, fts.rank, l.created_at
			FROM ltm_fts fts
			JOIN long_term_memories l ON l.id = fts.rowid
			WHERE ltm_fts MATCH ?
		`
		const params: (string | number)[] = [ftsQuery]
		if (opts?.type) { sql += ` AND l.type = ?`; params.push(opts.type) }
		sql += ` ORDER BY fts.rank LIMIT ?`
		params.push(limit)

		const rows = db.query(sql).all(...params) as Record<string, unknown>[]
		return rows.map(r => ({
			id: r.id as number,
			rank: r.rank as number,
			createdAt: r.created_at as string,
		}))
	} catch {
		return []
	}
}

// ═════════════════════════════════════════════════════════════════════════════
// SINGLE-RECORD GETTERS
// ═════════════════════════════════════════════════════════════════════════════

export function getObservationById(db: Database, id: number): Observation | null {
	const row = db.query(`SELECT * FROM observations WHERE id = ?`).get(id) as Record<string, unknown> | null
	return row ? rowToObservation(row) : null
}

export function getLTMById(db: Database, id: number): LTMEntry | null {
	const row = db.query(`SELECT * FROM long_term_memories WHERE id = ?`).get(id) as Record<string, unknown> | null
	return row ? rowToLTM(row) : null
}

export function getLTMByIds(db: Database, ids: number[]): LTMEntry[] {
	if (ids.length === 0) return []
	const placeholders = ids.map(() => "?").join(",")
	const rows = db.query(
		`SELECT * FROM long_term_memories WHERE id IN (${placeholders}) ORDER BY id ASC`,
	).all(...ids) as Record<string, unknown>[]
	return rows.map(rowToLTM)
}

// ═════════════════════════════════════════════════════════════════════════════
// OBSERVATION ENRICHMENT UPDATE
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Update observation fields after AI enrichment.
 * FTS5 triggers handle automatic re-indexing on UPDATE.
 */
export function updateObservationEnrichment(
	db: Database,
	id: number,
	fields: {
		type?: string
		title?: string
		narrative?: string
		facts?: string[]
		concepts?: string[]
	},
): void {
	const sets: string[] = []
	const params: unknown[] = []

	if (fields.type) { sets.push("type = ?"); params.push(fields.type) }
	if (fields.title) { sets.push("title = ?"); params.push(fields.title) }
	if (fields.narrative) { sets.push("narrative = ?"); params.push(fields.narrative) }
	if (fields.facts) { sets.push("facts = ?"); params.push(JSON.stringify(fields.facts)) }
	if (fields.concepts) { sets.push("concepts = ?"); params.push(JSON.stringify(fields.concepts)) }

	if (sets.length === 0) return

	params.push(id)
	db.run(`UPDATE observations SET ${sets.join(", ")} WHERE id = ?`, params)
}

// ═════════════════════════════════════════════════════════════════════════════
// SESSION META
// ═════════════════════════════════════════════════════════════════════════════

export function ensureSession(db: Database, sessionId: string): void {
	db.run(`INSERT OR IGNORE INTO session_meta (id) VALUES (?)`, [sessionId])
}

export function incrementPromptCount(db: Database, sessionId: string): number {
	ensureSession(db, sessionId)
	db.run(
		`UPDATE session_meta SET prompt_count = prompt_count + 1 WHERE id = ?`,
		[sessionId],
	)
	const row = db.query(`SELECT prompt_count FROM session_meta WHERE id = ?`).get(sessionId) as { prompt_count: number } | null
	return row?.prompt_count ?? 0
}

export function completeSession(db: Database, sessionId: string): void {
	db.run(
		`UPDATE session_meta SET status = 'completed', completed_at = datetime('now') WHERE id = ?`,
		[sessionId],
	)
}

export function markConsolidated(db: Database, sessionId: string): void {
	db.run(
		`UPDATE session_meta SET last_consolidated_at = datetime('now') WHERE id = ?`,
		[sessionId],
	)
}

export function getSessionMeta(db: Database, sessionId: string): SessionMeta | null {
	const row = db.query(`SELECT * FROM session_meta WHERE id = ?`).get(sessionId) as Record<string, unknown> | null
	if (!row) return null
	return {
		id: row.id as string,
		promptCount: row.prompt_count as number,
		observationCount: row.observation_count as number,
		lastConsolidatedAt: row.last_consolidated_at as string | null,
		status: row.status as "active" | "completed",
		startedAt: row.started_at as string,
		completedAt: row.completed_at as string | null,
	}
}

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function rowToObservation(row: Record<string, unknown>): Observation {
	return {
		id: row.id as number,
		sessionId: row.session_id as string,
		type: row.type as Observation["type"],
		title: row.title as string,
		narrative: (row.narrative as string) ?? "",
		facts: safeJsonArray(row.facts),
		concepts: safeJsonArray(row.concepts),
		filesRead: safeJsonArray(row.files_read),
		filesModified: safeJsonArray(row.files_modified),
		toolName: row.tool_name as string,
		promptNumber: row.prompt_number as number | null,
		createdAt: row.created_at as string,
	}
}

function rowToLTM(row: Record<string, unknown>): LTMEntry {
	return {
		id: row.id as number,
		type: row.type as LTMEntry["type"],
		content: row.content as string,
		caption: (row.caption as string) ?? null,
		context: (row.context as string) ?? null,
		sourceSessionId: (row.source_session_id as string) ?? null,
		sourceObservationIds: safeJsonArray(row.source_observation_ids).map(Number),
		tags: safeJsonArray(row.tags),
		files: safeJsonArray(row.files),
		createdAt: row.created_at as string,
		updatedAt: row.updated_at as string,
	}
}

function safeJsonArray(val: unknown): string[] {
	if (typeof val !== "string") return []
	try {
		const parsed = JSON.parse(val)
		return Array.isArray(parsed) ? parsed : []
	} catch {
		return []
	}
}

/**
 * Escape a user query for FTS5 MATCH syntax.
 * Wraps each word in quotes, passes through AND/OR/NOT operators.
 */
function escapeFts5(query: string): string {
	const operators = new Set(["AND", "OR", "NOT"])
	return query
		.split(/\s+/)
		.filter(Boolean)
		.map((token) => {
			if (operators.has(token.toUpperCase())) return token.toUpperCase()
			if (token.startsWith('"') && token.endsWith('"')) return token
			return `"${token.replace(/"/g, "")}"`
		})
		.join(" ")
}
