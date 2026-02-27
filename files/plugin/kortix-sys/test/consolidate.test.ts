import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test"
import { unlinkSync } from "node:fs"
import { initDb, insertObservation, getAllLTM, getRecentLTM, ensureSession, insertLTM } from "../src/db"
import { consolidateMemories, type ConsolidateOptions } from "../src/consolidate"
import type { CreateObservationInput } from "../src/types"
import type { Database } from "bun:sqlite"

const TEST_DB_PATH = "/tmp/kortix-memory-consolidate-test.db"
let db: Database

const noopLog = () => {}

function makeObs(overrides: Partial<CreateObservationInput> = {}): CreateObservationInput {
	return {
		sessionId: "ses_test",
		type: "discovery",
		title: "Read some file",
		narrative: "Read a file to understand the codebase",
		facts: ["Found auth module"],
		concepts: ["auth"],
		filesRead: ["/src/auth.ts"],
		filesModified: [],
		toolName: "read",
		promptNumber: 1,
		...overrides,
	}
}

beforeEach(() => {
	try { unlinkSync(TEST_DB_PATH) } catch { /* */ }
	db = initDb(TEST_DB_PATH)
	ensureSession(db, "ses_test")
})

afterEach(() => {
	db.close()
	try { unlinkSync(TEST_DB_PATH) } catch { /* */ }
})

// ─── Mock LLM response ──────────────────────────────────────────────────────

function mockFetchWith(response: object) {
	return mock((url: string | URL | Request, init?: RequestInit) => {
		return Promise.resolve(new Response(JSON.stringify(response), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		}))
	})
}

const VALID_LLM_RESPONSE = {
	choices: [{
		message: {
			content: JSON.stringify({
				episodic: [
					{
						content: "Built authentication system with JWT",
						context: "Session focused on auth module",
						tags: ["auth", "jwt"],
						files: ["/src/auth.ts"],
						source_observation_ids: [1],
					},
				],
				semantic: [
					{
						content: "The API uses JWT refresh tokens at /api/auth/refresh",
						context: "Core architectural fact",
						tags: ["auth", "jwt", "api"],
						files: ["/src/auth.ts"],
						source_observation_ids: [1],
					},
				],
				procedural: [
					{
						content: "To test auth: run bun test src/auth.test.ts",
						tags: ["testing", "auth"],
						files: ["/src/auth.test.ts"],
						source_observation_ids: [1],
					},
				],
				}),
		},
	}],
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("consolidateMemories", () => {
	it("does nothing when session has no observations", async () => {
		const originalFetch = globalThis.fetch
		globalThis.fetch = mockFetchWith(VALID_LLM_RESPONSE) as any

		const result = await consolidateMemories(db, "ses_test", noopLog, {
			kortixUrl: "http://localhost",
			kortixToken: "test",
		})

		expect(result.newMemories).toHaveLength(0)

		globalThis.fetch = originalFetch
	})

	it("consolidates observations into LTM entries", async () => {
		// Insert observations
		insertObservation(db, makeObs({ title: "Read auth.ts" }))
		insertObservation(db, makeObs({ title: "Edited auth.ts", type: "change" }))

		const originalFetch = globalThis.fetch
		globalThis.fetch = mockFetchWith(VALID_LLM_RESPONSE) as any

		const result = await consolidateMemories(db, "ses_test", noopLog, {
			kortixUrl: "http://localhost",
			kortixToken: "test",
		})

		expect(result.newMemories.length).toBeGreaterThan(0)

		// Check that LTM entries were inserted into DB
		const allLTM = getAllLTM(db)
		expect(allLTM.length).toBeGreaterThan(0)

		// Should have at least one of each type
		const types = allLTM.map((m) => m.type)
		expect(types).toContain("episodic")
		expect(types).toContain("semantic")
		expect(types).toContain("procedural")

		globalThis.fetch = originalFetch
	})

	it("handles LLM failure gracefully — returns empty result", async () => {
		insertObservation(db, makeObs())

		const originalFetch = globalThis.fetch
		globalThis.fetch = mock(() => Promise.resolve(new Response("Internal Server Error", { status: 500 }))) as any

		const result = await consolidateMemories(db, "ses_test", noopLog, {
			kortixUrl: "http://localhost",
			kortixToken: "test",
		})

		expect(result.newMemories).toHaveLength(0)

		// No LTM entries should exist
		const allLTM = getAllLTM(db)
		expect(allLTM).toHaveLength(0)

		globalThis.fetch = originalFetch
	})

	it("handles malformed JSON response gracefully", async () => {
		insertObservation(db, makeObs())

		const originalFetch = globalThis.fetch
		globalThis.fetch = mock(() => Promise.resolve(new Response(
			JSON.stringify({ choices: [{ message: { content: "not valid json" } }] }),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		))) as any

		const result = await consolidateMemories(db, "ses_test", noopLog, {
			kortixUrl: "http://localhost",
			kortixToken: "test",
		})

		expect(result.newMemories).toHaveLength(0)

		globalThis.fetch = originalFetch
	})

	it("passes existing LTM to LLM for deduplication context", async () => {
		// Pre-existing LTM
		insertLTM(db, {
			type: "semantic",
			content: "Existing fact about auth",
			tags: ["auth"],
		})

		insertObservation(db, makeObs())

		let capturedBody = ""
		const originalFetch = globalThis.fetch
		globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
			capturedBody = (init?.body as string) ?? ""
			return Promise.resolve(new Response(JSON.stringify(VALID_LLM_RESPONSE), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}))
		}) as any

		await consolidateMemories(db, "ses_test", noopLog, {
			kortixUrl: "http://localhost",
			kortixToken: "test",
		})

		expect(capturedBody.length).toBeGreaterThan(0)
		expect(capturedBody).toContain("Existing fact about auth")

		globalThis.fetch = originalFetch
	})

	it("returns empty when no LLM provider is configured", async () => {
		insertObservation(db, makeObs())

		const result = await consolidateMemories(db, "ses_test", noopLog, {
			// No kortixUrl, no anthropicKey
		})

		expect(result.newMemories).toHaveLength(0)
	})

	it("sends correct OpenAI-compatible format to Kortix", async () => {
		insertObservation(db, makeObs())

		let capturedUrl = ""
		let capturedHeaders: Record<string, string> = {}
		let capturedBody: Record<string, any> = {}

		const originalFetch = globalThis.fetch
		globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
			capturedUrl = String(url)
			capturedHeaders = Object.fromEntries(new Headers(init?.headers).entries())
			capturedBody = JSON.parse((init?.body as string) ?? "{}")
			return Promise.resolve(new Response(JSON.stringify(VALID_LLM_RESPONSE), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}))
		}) as any

		await consolidateMemories(db, "ses_test", noopLog, {
			kortixUrl: "http://localhost:8080",
			kortixToken: "tok_abc",
		})

		expect(capturedUrl).toBe("http://localhost:8080/chat/completions")
		expect(capturedHeaders.authorization).toBe("Bearer tok_abc")
		expect(capturedBody.messages).toHaveLength(2) // system + user
		expect(capturedBody.messages[0].role).toBe("system")
		expect(capturedBody.messages[1].role).toBe("user")

		globalThis.fetch = originalFetch
	})
})
