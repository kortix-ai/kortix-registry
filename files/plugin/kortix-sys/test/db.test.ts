import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { unlinkSync } from "node:fs"
import {
	initDb,
	insertObservation,
	getRecentObservations,
	getObservationsBySession,
	getObservationsByIds,
	searchObservationsFts,
	insertLTM,
	getRecentLTM,
	getLTMByType,
	getAllLTM,
	searchLTMFts,

	unifiedSearch,
	ensureSession,
	incrementPromptCount,
	completeSession,
	getSessionMeta,
	markConsolidated,
} from "../src/db"
import type { CreateObservationInput, CreateLTMInput } from "../src/types"
import type { Database } from "bun:sqlite"

// ─── Test Helpers ────────────────────────────────────────────────────────────

const TEST_DB_PATH = "/tmp/kortix-memory-test.db"

let db: Database

function makeObs(overrides: Partial<CreateObservationInput> = {}): CreateObservationInput {
	return {
		sessionId: "ses_test1",
		type: "discovery",
		title: "Read auth middleware",
		narrative: "Read the auth middleware to understand JWT handling",
		facts: ["Uses refresh tokens", "Expiry set to 24h"],
		concepts: ["auth", "jwt"],
		filesRead: ["/src/auth/middleware.ts"],
		filesModified: [],
		toolName: "read",
		promptNumber: 1,
		...overrides,
	}
}

function makeLTM(overrides: Partial<CreateLTMInput> = {}): CreateLTMInput {
	return {
		type: "semantic",
		content: "The API uses JWT refresh tokens at /api/auth/refresh",
		context: "Discovered while reading auth middleware",
		sourceSessionId: "ses_test1",
		sourceObservationIds: [1, 2],
		tags: ["auth", "jwt", "api"],
		files: ["/src/auth/middleware.ts"],
		...overrides,
	}
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(() => {
	try { unlinkSync(TEST_DB_PATH) } catch { /* doesn't exist */ }
	db = initDb(TEST_DB_PATH)
})

afterEach(() => {
	db.close()
	try { unlinkSync(TEST_DB_PATH) } catch { /* cleanup */ }
})

// ─── Observations ────────────────────────────────────────────────────────────

describe("observations", () => {
	it("inserts and retrieves an observation", () => {
		const id = insertObservation(db, makeObs())
		expect(id).toBeGreaterThan(0)

		const all = getRecentObservations(db, 10)
		expect(all).toHaveLength(1)
		expect(all[0].title).toBe("Read auth middleware")
		expect(all[0].facts).toEqual(["Uses refresh tokens", "Expiry set to 24h"])
		expect(all[0].filesRead).toEqual(["/src/auth/middleware.ts"])
	})

	it("returns observations in reverse chronological order", () => {
		insertObservation(db, makeObs({ title: "First" }))
		insertObservation(db, makeObs({ title: "Second" }))
		insertObservation(db, makeObs({ title: "Third" }))

		const all = getRecentObservations(db, 10)
		expect(all[0].title).toBe("Third")
		expect(all[2].title).toBe("First")
	})

	it("filters by session", () => {
		insertObservation(db, makeObs({ sessionId: "ses_a", title: "A" }))
		insertObservation(db, makeObs({ sessionId: "ses_b", title: "B" }))

		const sesA = getObservationsBySession(db, "ses_a")
		expect(sesA).toHaveLength(1)
		expect(sesA[0].title).toBe("A")
	})

	it("fetches by IDs", () => {
		const id1 = insertObservation(db, makeObs({ title: "One" }))
		insertObservation(db, makeObs({ title: "Two" }))
		const id3 = insertObservation(db, makeObs({ title: "Three" }))

		const result = getObservationsByIds(db, [id1, id3])
		expect(result).toHaveLength(2)
		expect(result[0].title).toBe("One")
		expect(result[1].title).toBe("Three")
	})

	it("returns empty for non-existent IDs", () => {
		const result = getObservationsByIds(db, [999])
		expect(result).toHaveLength(0)
	})

	it("returns empty for empty ID array", () => {
		const result = getObservationsByIds(db, [])
		expect(result).toHaveLength(0)
	})

	it("respects limit", () => {
		for (let i = 0; i < 10; i++) {
			insertObservation(db, makeObs({ title: `Obs ${i}` }))
		}
		const result = getRecentObservations(db, 3)
		expect(result).toHaveLength(3)
	})

	it("increments session observation count", () => {
		ensureSession(db, "ses_test1")
		insertObservation(db, makeObs())
		insertObservation(db, makeObs())
		const meta = getSessionMeta(db, "ses_test1")
		expect(meta?.observationCount).toBe(2)
	})
})

// ─── Observation FTS5 Search ─────────────────────────────────────────────────

describe("observation FTS5 search", () => {
	it("finds by title keyword", () => {
		insertObservation(db, makeObs({ title: "Read auth middleware" }))
		insertObservation(db, makeObs({ title: "Edited package.json" }))

		const results = searchObservationsFts(db, "auth")
		expect(results.length).toBeGreaterThanOrEqual(1)
		expect(results[0].title).toContain("auth")
	})

	it("finds by narrative keyword", () => {
		insertObservation(db, makeObs({ narrative: "JWT refresh token handling" }))

		const results = searchObservationsFts(db, "JWT refresh")
		expect(results.length).toBeGreaterThanOrEqual(1)
	})

	it("finds by fact content", () => {
		insertObservation(db, makeObs({ facts: ["Uses bcrypt for password hashing"] }))

		const results = searchObservationsFts(db, "bcrypt")
		expect(results.length).toBeGreaterThanOrEqual(1)
	})

	it("finds by concept", () => {
		insertObservation(db, makeObs({ concepts: ["docker", "kubernetes"] }))

		const results = searchObservationsFts(db, "kubernetes")
		expect(results.length).toBeGreaterThanOrEqual(1)
	})

	it("returns empty for no match", () => {
		insertObservation(db, makeObs())
		const results = searchObservationsFts(db, "xyznonexistent")
		expect(results).toHaveLength(0)
	})

	it("respects limit", () => {
		for (let i = 0; i < 10; i++) {
			insertObservation(db, makeObs({ title: `Auth thing ${i}` }))
		}
		const results = searchObservationsFts(db, "Auth", { limit: 3 })
		expect(results).toHaveLength(3)
	})

	it("falls back to LIKE on FTS5 parse error", () => {
		insertObservation(db, makeObs({ title: "Something with auth" }))
		// Malformed FTS5 query should fall back to LIKE
		const results = searchObservationsFts(db, "auth)")
		expect(results.length).toBeGreaterThanOrEqual(1)
	})
})

// ─── Long-Term Memories ──────────────────────────────────────────────────────

describe("long_term_memories", () => {
	it("inserts and retrieves an LTM entry", () => {
		const id = insertLTM(db, makeLTM())
		expect(id).toBeGreaterThan(0)

		const all = getRecentLTM(db, 10)
		expect(all).toHaveLength(1)
		expect(all[0].type).toBe("semantic")
		expect(all[0].content).toContain("JWT refresh tokens")
		expect(all[0].tags).toEqual(["auth", "jwt", "api"])
	})

	it("filters by type", () => {
		insertLTM(db, makeLTM({ type: "episodic", content: "Built auth system" }))
		insertLTM(db, makeLTM({ type: "semantic", content: "Uses JWT" }))
		insertLTM(db, makeLTM({ type: "procedural", content: "Deploy: bun build" }))

		const semantic = getLTMByType(db, "semantic", 10)
		expect(semantic).toHaveLength(1)
		expect(semantic[0].content).toContain("JWT")

		const procedural = getLTMByType(db, "procedural", 10)
		expect(procedural).toHaveLength(1)
		expect(procedural[0].content).toContain("Deploy")
	})

	it("returns all LTM entries", () => {
		insertLTM(db, makeLTM({ content: "Fact 1" }))
		insertLTM(db, makeLTM({ content: "Fact 2" }))

		const all = getAllLTM(db)
		expect(all).toHaveLength(2)
	})

	it("stores source observation IDs", () => {
		insertLTM(db, makeLTM({ sourceObservationIds: [5, 10, 15] }))

		const all = getRecentLTM(db, 10)
		expect(all[0].sourceObservationIds).toEqual([5, 10, 15])
	})

	it("handles defaults for optional fields", () => {
		const id = insertLTM(db, {
			type: "semantic",
			content: "Minimal entry",
		})

		const all = getRecentLTM(db, 10)
		expect(all[0].tags).toEqual([])
		expect(all[0].files).toEqual([])
		expect(all[0].sourceObservationIds).toEqual([])
		expect(all[0].context).toBeNull()
	})
})

// ─── LTM FTS5 Search ────────────────────────────────────────────────────────

describe("LTM FTS5 search", () => {
	it("finds by content keyword", () => {
		insertLTM(db, makeLTM({ content: "Frontend uses SolidJS with Tailwind" }))
		insertLTM(db, makeLTM({ content: "Backend uses Express with Prisma" }))

		const results = searchLTMFts(db, "SolidJS")
		expect(results.length).toBeGreaterThanOrEqual(1)
		expect(results[0].content).toContain("SolidJS")
	})

	it("finds by tag", () => {
		insertLTM(db, makeLTM({ tags: ["docker", "deployment"] }))

		const results = searchLTMFts(db, "docker")
		expect(results.length).toBeGreaterThanOrEqual(1)
	})

	it("finds by context", () => {
		insertLTM(db, makeLTM({ context: "Found while debugging CORS proxy" }))

		const results = searchLTMFts(db, "CORS")
		expect(results.length).toBeGreaterThanOrEqual(1)
	})
})

// ─── Unified Search ──────────────────────────────────────────────────────────

describe("unified search", () => {
	it("returns results from both observations and LTM", () => {
		insertObservation(db, makeObs({ title: "Read auth config" }))
		insertLTM(db, makeLTM({ content: "Auth uses JWT refresh tokens" }))

		const results = unifiedSearch(db, "auth")
		expect(results.length).toBeGreaterThanOrEqual(2)

		const sources = results.map((r) => r.source)
		expect(sources).toContain("observation")
		expect(sources).toContain("ltm")
	})

	it("ranks LTM higher than observations", () => {
		insertObservation(db, makeObs({ title: "Read auth file" }))
		insertLTM(db, makeLTM({ content: "Auth uses JWT" }))

		const results = unifiedSearch(db, "auth")
		// LTM should appear before observations
		const ltmIdx = results.findIndex((r) => r.source === "ltm")
		const obsIdx = results.findIndex((r) => r.source === "observation")
		if (ltmIdx !== -1 && obsIdx !== -1) {
			expect(ltmIdx).toBeLessThan(obsIdx)
		}
	})

	it("respects source filter", () => {
		insertObservation(db, makeObs({ title: "Read auth config" }))
		insertLTM(db, makeLTM({ content: "Auth uses JWT" }))

		const obsOnly = unifiedSearch(db, "auth", { source: "observation" })
		expect(obsOnly.every((r) => r.source === "observation")).toBe(true)

		const ltmOnly = unifiedSearch(db, "auth", { source: "ltm" })
		expect(ltmOnly.every((r) => r.source === "ltm")).toBe(true)
	})

	it("respects limit", () => {
		for (let i = 0; i < 10; i++) {
			insertObservation(db, makeObs({ title: `Auth operation ${i}` }))
		}
		const results = unifiedSearch(db, "Auth", { limit: 3 })
		expect(results).toHaveLength(3)
	})
})

// ─── Session Meta ────────────────────────────────────────────────────────────

describe("session meta", () => {
	it("creates and retrieves session", () => {
		ensureSession(db, "ses_new")
		const meta = getSessionMeta(db, "ses_new")
		expect(meta).not.toBeNull()
		expect(meta!.id).toBe("ses_new")
		expect(meta!.status).toBe("active")
		expect(meta!.promptCount).toBe(0)
	})

	it("increments prompt count", () => {
		ensureSession(db, "ses_new")
		incrementPromptCount(db, "ses_new")
		incrementPromptCount(db, "ses_new")
		const meta = getSessionMeta(db, "ses_new")
		expect(meta!.promptCount).toBe(2)
	})

	it("completes session", () => {
		ensureSession(db, "ses_new")
		completeSession(db, "ses_new")
		const meta = getSessionMeta(db, "ses_new")
		expect(meta!.status).toBe("completed")
		expect(meta!.completedAt).not.toBeNull()
	})

	it("marks session as consolidated", () => {
		ensureSession(db, "ses_new")
		markConsolidated(db, "ses_new")
		const meta = getSessionMeta(db, "ses_new")
		expect(meta!.lastConsolidatedAt).not.toBeNull()
	})

	it("does not duplicate on repeated ensure", () => {
		ensureSession(db, "ses_dup")
		ensureSession(db, "ses_dup")
		const meta = getSessionMeta(db, "ses_dup")
		expect(meta).not.toBeNull()
	})

	it("returns null for non-existent session", () => {
		const meta = getSessionMeta(db, "ses_nonexistent")
		expect(meta).toBeNull()
	})
})
