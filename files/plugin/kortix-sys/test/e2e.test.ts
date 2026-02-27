/**
 * Agentic E2E Tests — Simulating Real User Workflows
 *
 * These tests simulate what actually happens when a user uses OpenCode
 * with the memory plugin installed. Each test is a realistic scenario
 * that exercises the full pipeline end-to-end.
 *
 * We mock only the LLM API (fetch) — everything else (SQLite, FTS5,
 * file I/O, observation extraction, consolidation, context injection)
 * runs for real.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { unlinkSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs"
import { initDb, insertObservation, getObservationsBySession, getAllLTM, getRecentLTM, getLTMByType, insertLTM, unifiedSearch, ensureSession, incrementPromptCount, markConsolidated, getSessionMeta, searchObservationsFts, searchLTMFts } from "../src/db"
import { extractObservation, type RawToolData } from "../src/extract"
import { consolidateMemories } from "../src/consolidate"
import { generateLTMBlock } from "../src/context"
import { ensureMemDir, writeObservationFile, writeLTMFile } from "../src/lss"
import type { Database } from "bun:sqlite"

// ─── Shared Setup ────────────────────────────────────────────────────────────

const TEST_DB = "/tmp/e2e-memory-test.db"
const TEST_LSS_DIR = "/tmp/e2e-memory-lss"
let db: Database
const noopLog = () => {}

function mockLLMResponse(response: object) {
	return mock((_url: string | URL | Request, _init?: RequestInit) =>
		Promise.resolve(new Response(JSON.stringify(response), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		}))
	)
}

beforeEach(() => {
	try { unlinkSync(TEST_DB) } catch {}
	rmSync(TEST_LSS_DIR, { recursive: true, force: true })
	db = initDb(TEST_DB)
	ensureMemDir(TEST_LSS_DIR)
})

afterEach(() => {
	db.close()
	try { unlinkSync(TEST_DB) } catch {}
	rmSync(TEST_LSS_DIR, { recursive: true, force: true })
})

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 1: "Developer explores a new codebase"
//
// User asks the agent to understand an unfamiliar project.
// Agent reads files, greps for patterns, runs the build.
// After compaction, the key architectural insights persist as LTM.
// ═════════════════════════════════════════════════════════════════════════════

describe("Scenario 1: Developer explores new codebase", () => {
	const SESSION_ID = "ses_explore_codebase"

	const toolCalls: RawToolData[] = [
		{ tool: "read", args: { filePath: "/src/index.ts" }, output: "Express app with routes..." },
		{ tool: "read", args: { filePath: "/src/auth/middleware.ts" }, output: "JWT verification with refresh tokens..." },
		{ tool: "grep", args: { pattern: "database" }, output: "src/db/prisma.ts:5\nsrc/db/migrations/:3\n" },
		{ tool: "read", args: { filePath: "/src/db/prisma.ts" }, output: "Prisma client with PostgreSQL..." },
		{ tool: "read", args: { filePath: "/docker-compose.yml" }, output: "services: postgres, redis, app..." },
		{ tool: "bash", args: { command: "npm run build" }, output: "Build succeeded in 4.2s" },
		{ tool: "read", args: { filePath: "/src/api/routes.ts" }, output: "REST routes: /users, /auth, /posts..." },
		{ tool: "grep", args: { pattern: "env\\." }, output: "src/config.ts:2\nsrc/db/prisma.ts:1\n" },
		{ tool: "read", args: { filePath: "/src/config.ts" }, output: "PORT=3000, DATABASE_URL, REDIS_URL, JWT_SECRET..." },
		{ tool: "bash", args: { command: "npm test" }, output: "42 tests passed, 0 failed" },
	]

	it("full lifecycle: explore → observe → compact → recall", async () => {
		// Phase 1: Session starts, agent explores
		ensureSession(db, SESSION_ID)
		let promptCount = 0

		for (const call of toolCalls) {
			promptCount++
			incrementPromptCount(db, SESSION_ID)
			const obs = extractObservation(call, SESSION_ID, promptCount)
			if (obs) {
				const id = insertObservation(db, obs)
				writeObservationFile(TEST_LSS_DIR, id, {
					title: obs.title,
					narrative: obs.narrative,
					type: obs.type,
					facts: obs.facts,
					concepts: obs.concepts,
					filesRead: obs.filesRead,
					filesModified: obs.filesModified,
				})
			}
		}

		// Verify: observations accumulated
		const observations = getObservationsBySession(db, SESSION_ID)
		expect(observations.length).toBe(10)

		// Verify: session meta tracks state
		const meta = getSessionMeta(db, SESSION_ID)
		expect(meta?.promptCount).toBe(10)
		expect(meta?.observationCount).toBe(10)

		// Verify: LSS files written
		const lssFiles = readdirSync(TEST_LSS_DIR)
		expect(lssFiles.filter(f => f.startsWith("obs_")).length).toBe(10)

		// Phase 2: Compaction fires — LLM consolidates observations into LTM
		const llmResponse = {
			choices: [{
				message: {
					content: JSON.stringify({
						episodic: [
							{
								content: "Explored full-stack Express app with JWT auth, Prisma/PostgreSQL, and Redis",
								context: "Initial codebase exploration — all 42 tests passing",
								tags: ["exploration", "express", "fullstack"],
								files: ["/src/index.ts", "/src/auth/middleware.ts"],
								source_observation_ids: [1, 2, 3, 4, 5],
							},
						],
						semantic: [
							{
								content: "Backend uses Express with JWT refresh tokens for auth at /src/auth/middleware.ts",
								tags: ["auth", "jwt", "express"],
								files: ["/src/auth/middleware.ts"],
								source_observation_ids: [2],
							},
							{
								content: "Database layer uses Prisma ORM with PostgreSQL",
								tags: ["database", "prisma", "postgresql"],
								files: ["/src/db/prisma.ts"],
								source_observation_ids: [4],
							},
							{
								content: "Infrastructure runs via Docker Compose: postgres, redis, app services",
								tags: ["docker", "infrastructure"],
								files: ["/docker-compose.yml"],
								source_observation_ids: [5],
							},
							{
								content: "Config at /src/config.ts: PORT=3000, DATABASE_URL, REDIS_URL, JWT_SECRET",
								tags: ["config", "environment"],
								files: ["/src/config.ts"],
								source_observation_ids: [9],
							},
						],
						procedural: [
							{
								content: "Build: npm run build (succeeds in ~4s). Tests: npm test (42 tests).",
								tags: ["build", "testing"],
								files: [],
								source_observation_ids: [6, 10],
							},
						],
						}),
				},
			}],
		}

		const originalFetch = globalThis.fetch
		globalThis.fetch = mockLLMResponse(llmResponse) as any

		const result = await consolidateMemories(db, SESSION_ID, noopLog, {
			kortixUrl: "http://mock-llm",
			kortixToken: "test",
		})

		globalThis.fetch = originalFetch

		// Verify: LTM entries created
		expect(result.newMemories.length).toBe(6) // 1 episodic + 4 semantic + 1 procedural
		const allLTM = getAllLTM(db)
		expect(allLTM.length).toBe(6)

		const episodic = getLTMByType(db, "episodic", 10)
		expect(episodic.length).toBe(1)
		expect(episodic[0].content).toContain("Express app")

		const semantic = getLTMByType(db, "semantic", 10)
		expect(semantic.length).toBe(4)

		const procedural = getLTMByType(db, "procedural", 10)
		expect(procedural.length).toBe(1)
		expect(procedural[0].content).toContain("npm run build")

		// Phase 3: Generate LTM block for next session's context
		const ltmBlock = generateLTMBlock(db)
		expect(ltmBlock).toContain("<long-term-memory>")
		expect(ltmBlock).toContain("## Episodic")
		expect(ltmBlock).toContain("## Semantic")
		expect(ltmBlock).toContain("## Procedural")
		expect(ltmBlock).toContain("JWT refresh tokens")
		expect(ltmBlock).toContain("Prisma ORM")
		expect(ltmBlock).toContain("Docker Compose")
		expect(ltmBlock).toContain("npm run build")
		expect(ltmBlock).toContain("</long-term-memory>")

		// Phase 4: Session marked as consolidated
		const metaAfter = getSessionMeta(db, SESSION_ID)
		expect(metaAfter?.lastConsolidatedAt).not.toBeNull()
	})
})

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 2: "Developer comes back the next day"
//
// Previous session's LTM is already in the DB.
// Agent starts a new session. LTM block should be available for injection.
// Agent searches for past knowledge using mem_search.
// ═════════════════════════════════════════════════════════════════════════════

describe("Scenario 2: Cross-session memory recall", () => {
	it("new session sees LTM from previous sessions", () => {
		// Seed LTM from "yesterday's" sessions
		insertLTM(db, {
			type: "semantic",
			content: "Frontend uses SolidJS with Tailwind at apps/frontend/",
			sourceSessionId: "ses_yesterday_1",
			tags: ["frontend", "solidjs", "tailwind"],
			files: ["/apps/frontend/"],
		})
		insertLTM(db, {
			type: "semantic",
			content: "API auth uses JWT refresh tokens at /api/auth/refresh",
			sourceSessionId: "ses_yesterday_1",
			tags: ["auth", "jwt", "api"],
			files: ["/src/auth/middleware.ts"],
		})
		insertLTM(db, {
			type: "procedural",
			content: "Use portless <name> <cmd> for dev servers to avoid port conflicts",
			sourceSessionId: "ses_yesterday_2",
			tags: ["dev", "portless", "workflow"],
		})
		insertLTM(db, {
			type: "episodic",
			content: "Feb 23: Fixed CORS proxy bug in the API gateway",
			sourceSessionId: "ses_yesterday_2",
			tags: ["bugfix", "cors", "proxy"],
		})

		// New session starts — generate LTM block
		const ltmBlock = generateLTMBlock(db)

		// LTM from previous sessions should be present
		expect(ltmBlock).toContain("SolidJS")
		expect(ltmBlock).toContain("JWT refresh tokens")
		expect(ltmBlock).toContain("portless")
		expect(ltmBlock).toContain("CORS proxy")

		// Unified search should find cross-session knowledge
		const authResults = unifiedSearch(db, "auth JWT", { source: "ltm" })
		expect(authResults.length).toBeGreaterThanOrEqual(1)
		expect(authResults[0].content).toContain("JWT")

		const corsResults = unifiedSearch(db, "CORS proxy bug")
		expect(corsResults.length).toBeGreaterThanOrEqual(1)
	})
})

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 3: "Agent manually saves an important finding"
//
// During a session, agent discovers something critical and uses mem_save
// to persist it immediately (doesn't wait for compaction).
// ═════════════════════════════════════════════════════════════════════════════

describe("Scenario 3: Manual mem_save during session", () => {
	it("agent saves finding → immediately available in LTM block + search", () => {
		// Agent discovers something important and saves it
		const id = insertLTM(db, {
			type: "procedural",
			content: "To fix the flaky CI: delete node_modules/.cache before running tests",
			sourceSessionId: "ses_debugging",
			tags: ["ci", "testing", "flaky"],
		})
		writeLTMFile(TEST_LSS_DIR, id, "procedural", "To fix the flaky CI: delete node_modules/.cache before running tests", ["ci", "testing", "flaky"])

		// Immediately available in LTM block
		const ltmBlock = generateLTMBlock(db)
		expect(ltmBlock).toContain("flaky CI")
		expect(ltmBlock).toContain("node_modules/.cache")

		// Searchable immediately
		const results = unifiedSearch(db, "flaky CI")
		expect(results.length).toBeGreaterThanOrEqual(1)
		expect(results[0].source).toBe("ltm")
		expect(results[0].content).toContain("node_modules/.cache")

		// LSS file exists
		expect(existsSync(`${TEST_LSS_DIR}/ltm_procedural_${id}.md`)).toBe(true)
	})
})

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 5: "Multi-session accumulation"
//
// Simulates 3 sessions over 3 days. Each session produces observations
// and consolidates into LTM. The final LTM block should contain knowledge
// from all 3 sessions.
// ═════════════════════════════════════════════════════════════════════════════

describe("Scenario 5: Multi-session LTM accumulation", () => {
	it("LTM accumulates across sessions, all visible in final block", async () => {
		// Session 1: Setup project
		insertLTM(db, { type: "episodic", content: "Day 1: Initialized project with bun init, added Express + Prisma", sourceSessionId: "ses_day1", tags: ["setup"] })
		insertLTM(db, { type: "semantic", content: "Project uses Bun runtime with Express for HTTP", sourceSessionId: "ses_day1", tags: ["bun", "express"] })

		// Session 2: Add auth
		insertLTM(db, { type: "episodic", content: "Day 2: Implemented JWT auth with refresh token rotation", sourceSessionId: "ses_day2", tags: ["auth"] })
		insertLTM(db, { type: "semantic", content: "Auth tokens expire after 15min, refresh tokens after 7 days", sourceSessionId: "ses_day2", tags: ["auth", "jwt", "tokens"] })
		insertLTM(db, { type: "procedural", content: "Generate new JWT secret: openssl rand -base64 32", sourceSessionId: "ses_day2", tags: ["auth", "security"] })

		// Session 3: Add tests
		insertLTM(db, { type: "episodic", content: "Day 3: Added test suite with 95% coverage, fixed 3 edge cases", sourceSessionId: "ses_day3", tags: ["testing"] })
		insertLTM(db, { type: "procedural", content: "Run tests: bun test --coverage. Watch mode: bun test --watch", sourceSessionId: "ses_day3", tags: ["testing", "commands"] })

		// Final LTM block should contain ALL knowledge
		const ltmBlock = generateLTMBlock(db)

		// All sessions represented
		expect(ltmBlock).toContain("Day 1")
		expect(ltmBlock).toContain("Day 2")
		expect(ltmBlock).toContain("Day 3")

		// All types present
		expect(ltmBlock).toContain("## Episodic")
		expect(ltmBlock).toContain("## Semantic")
		expect(ltmBlock).toContain("## Procedural")

		// Key facts from each session
		expect(ltmBlock).toContain("Bun runtime")
		expect(ltmBlock).toContain("refresh token rotation")
		expect(ltmBlock).toContain("15min")
		expect(ltmBlock).toContain("openssl rand")
		expect(ltmBlock).toContain("95% coverage")
		expect(ltmBlock).toContain("bun test --coverage")

		// Search finds cross-session knowledge
		const authSearch = unifiedSearch(db, "auth tokens refresh", { source: "ltm" })
		expect(authSearch.length).toBeGreaterThanOrEqual(1)

		const testSearch = unifiedSearch(db, "test coverage", { source: "ltm" })
		expect(testSearch.length).toBeGreaterThanOrEqual(1)
	})
})

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 6: "Unified search: observations + LTM together"
//
// User searches for "auth" — should find both raw observations from
// the current session AND consolidated LTM from past sessions.
// LTM should rank higher.
// ═════════════════════════════════════════════════════════════════════════════

describe("Scenario 6: Unified search ranking", () => {
	it("LTM ranks above observations in unified search", () => {
		// Past session LTM
		insertLTM(db, {
			type: "semantic",
			content: "Auth middleware at /src/auth/middleware.ts validates JWT on every request",
			tags: ["auth", "jwt", "middleware"],
		})

		// Current session observations
		ensureSession(db, "ses_current")
		insertObservation(db, {
			sessionId: "ses_current",
			type: "discovery",
			title: "Read auth config",
			narrative: "Read /src/auth/config.ts to check JWT settings",
			facts: [],
			concepts: ["auth", "config"],
			filesRead: ["/src/auth/config.ts"],
			filesModified: [],
			toolName: "read",
			promptNumber: 1,
		})
		insertObservation(db, {
			sessionId: "ses_current",
			type: "change",
			title: "Edited auth middleware",
			narrative: "Updated token expiry from 1h to 15min",
			facts: ["expiry: 1h → 15min"],
			concepts: ["auth", "jwt"],
			filesRead: [],
			filesModified: ["/src/auth/middleware.ts"],
			toolName: "edit",
			promptNumber: 2,
		})

		// Unified search for "auth"
		const results = unifiedSearch(db, "auth")
		expect(results.length).toBeGreaterThanOrEqual(2)

		// LTM should be first
		expect(results[0].source).toBe("ltm")
		expect(results[0].content).toContain("Auth middleware")

		// Observations should follow
		const obsResults = results.filter(r => r.source === "observation")
		expect(obsResults.length).toBeGreaterThanOrEqual(1)
	})

	it("source filter works correctly", () => {
		insertLTM(db, { type: "semantic", content: "Auth fact", tags: ["auth"] })
		ensureSession(db, "ses_cur")
		insertObservation(db, {
			sessionId: "ses_cur", type: "discovery", title: "Auth read",
			narrative: "auth stuff", facts: [], concepts: ["auth"],
			filesRead: [], filesModified: [], toolName: "read", promptNumber: 1,
		})

		const ltmOnly = unifiedSearch(db, "auth", { source: "ltm" })
		expect(ltmOnly.every(r => r.source === "ltm")).toBe(true)

		const obsOnly = unifiedSearch(db, "auth", { source: "observation" })
		expect(obsOnly.every(r => r.source === "observation")).toBe(true)
	})
})

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 7: "Compaction with no LLM — graceful degradation"
//
// If no LLM provider is configured, consolidation should gracefully
// do nothing. Observations are still saved. mem_search still works.
// The plugin doesn't break.
// ═════════════════════════════════════════════════════════════════════════════

describe("Scenario 7: Graceful degradation without LLM", () => {
	it("plugin works without LLM — observations saved, search works, no LTM", async () => {
		const SESSION_ID = "ses_no_llm"
		ensureSession(db, SESSION_ID)

		// Simulate tool calls
		const calls: RawToolData[] = [
			{ tool: "read", args: { filePath: "/src/main.ts" }, output: "main file content" },
			{ tool: "bash", args: { command: "git status" }, output: "On branch main" },
			{ tool: "edit", args: { filePath: "/src/main.ts", oldString: "old", newString: "new" }, output: "edited" },
		]

		for (let i = 0; i < calls.length; i++) {
			incrementPromptCount(db, SESSION_ID)
			const obs = extractObservation(calls[i], SESSION_ID, i + 1)
			if (obs) insertObservation(db, obs)
		}

		// Observations saved
		const observations = getObservationsBySession(db, SESSION_ID)
		expect(observations.length).toBe(3)

		// Search works on observations
		const results = searchObservationsFts(db, "main")
		expect(results.length).toBeGreaterThanOrEqual(1)

		// Compaction without LLM — should not crash, return empty
		const result = await consolidateMemories(db, SESSION_ID, noopLog, {
			// No kortixUrl, no anthropicKey
		})
		expect(result.newMemories).toHaveLength(0)

		// No LTM created
		expect(getAllLTM(db)).toHaveLength(0)

		// LTM block is empty (no crash)
		expect(generateLTMBlock(db)).toBe("")
	})
})

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 8: "Full round-trip: save → search → recall"
//
// Tests the complete data flow:
// 1. Manual save via mem_save
// 2. Find it via mem_search
// 3. See it in the LTM recall block
// 4. Save observation, find in unified search alongside LTM
// ═════════════════════════════════════════════════════════════════════════════

describe("Scenario 8: Full round-trip save → search → recall", () => {
	it("complete data flow works end-to-end", () => {
		// Step 1: Agent manually saves a procedural memory
		const id = insertLTM(db, {
			type: "procedural",
			content: "To regenerate types: bun run codegen && bun run typecheck",
			sourceSessionId: "ses_roundtrip",
			tags: ["codegen", "types", "workflow"],
		})

		// Step 2: Search finds it
		const searchResults = unifiedSearch(db, "regenerate types codegen")
		expect(searchResults.length).toBeGreaterThanOrEqual(1)
		expect(searchResults[0].content).toContain("codegen")
		expect(searchResults[0].source).toBe("ltm")

		// Step 3: LTM recall block includes it
		const block = generateLTMBlock(db)
		expect(block).toContain("regenerate types")
		expect(block).toContain("bun run codegen")

		// Step 4: Observation + LTM appear together in unified search
		ensureSession(db, "ses_roundtrip")
		insertObservation(db, {
			sessionId: "ses_roundtrip",
			type: "change",
			title: "Ran codegen",
			narrative: "Executed bun run codegen to regenerate GraphQL types",
			facts: ["Generated 42 type files"],
			concepts: ["codegen", "graphql"],
			filesRead: [],
			filesModified: ["/generated/types.ts"],
			toolName: "bash",
			promptNumber: 1,
		})

		const unified = unifiedSearch(db, "codegen")
		expect(unified.length).toBeGreaterThanOrEqual(2)

		const sources = unified.map(r => r.source)
		expect(sources).toContain("ltm")
		expect(sources).toContain("observation")
	})
})
