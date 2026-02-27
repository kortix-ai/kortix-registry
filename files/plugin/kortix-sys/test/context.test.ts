import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { unlinkSync } from "node:fs"
import { initDb, insertLTM } from "../src/db"
import { generateLTMBlock } from "../src/context"
import type { CreateLTMInput } from "../src/types"
import type { Database } from "bun:sqlite"

const TEST_DB_PATH = "/tmp/kortix-memory-context-test.db"
let db: Database

function makeLTM(overrides: Partial<CreateLTMInput> = {}): CreateLTMInput {
	return {
		type: "semantic",
		content: "Test memory",
		tags: [],
		files: [],
		...overrides,
	}
}

beforeEach(() => {
	try { unlinkSync(TEST_DB_PATH) } catch { /* */ }
	db = initDb(TEST_DB_PATH)
})

afterEach(() => {
	db.close()
	try { unlinkSync(TEST_DB_PATH) } catch { /* */ }
})

describe("generateLTMBlock", () => {
	it("returns empty string when no LTM entries exist", () => {
		const block = generateLTMBlock(db)
		expect(block).toBe("")
	})

	it("wraps output in <long-term-memory> tags", () => {
		insertLTM(db, makeLTM({ type: "semantic", content: "SolidJS is the frontend framework" }))
		const block = generateLTMBlock(db)
		expect(block).toContain("<long-term-memory>")
		expect(block).toContain("</long-term-memory>")
	})

	it("groups entries by type", () => {
		insertLTM(db, makeLTM({ type: "episodic", content: "Built auth system on Feb 24" }))
		insertLTM(db, makeLTM({ type: "semantic", content: "API uses JWT at /api/auth" }))
		insertLTM(db, makeLTM({ type: "procedural", content: "Deploy: bun build then docker compose up" }))

		const block = generateLTMBlock(db)
		expect(block).toContain("## Episodic")
		expect(block).toContain("## Semantic")
		expect(block).toContain("## Procedural")
		expect(block).toContain("Built auth system")
		expect(block).toContain("JWT")
		expect(block).toContain("Deploy")
	})

	it("omits empty type sections", () => {
		insertLTM(db, makeLTM({ type: "semantic", content: "Only semantic here" }))
		const block = generateLTMBlock(db)
		expect(block).toContain("## Semantic")
		expect(block).not.toContain("## Episodic")
		expect(block).not.toContain("## Procedural")
	})

	it("orders by most recently updated within type", () => {
		insertLTM(db, makeLTM({ type: "semantic", content: "Older fact" }))
		insertLTM(db, makeLTM({ type: "semantic", content: "Newer fact" }))

		const block = generateLTMBlock(db)
		const newerIdx = block.indexOf("Newer fact")
		const olderIdx = block.indexOf("Older fact")
		// Most recently updated first
		expect(newerIdx).toBeLessThan(olderIdx)
	})

	it("respects per-type limits", () => {
		// Insert 20 semantic entries
		for (let i = 0; i < 20; i++) {
			insertLTM(db, makeLTM({ type: "semantic", content: `Semantic fact ${i}` }))
		}

		const block = generateLTMBlock(db, { semantic: 5 })
		const matches = block.match(/- Semantic fact/g)
		expect(matches).not.toBeNull()
		expect(matches!.length).toBe(5)
	})

	it("includes all three types with default limits", () => {
		for (let i = 0; i < 3; i++) {
			insertLTM(db, makeLTM({ type: "episodic", content: `Episode ${i}` }))
			insertLTM(db, makeLTM({ type: "semantic", content: `Fact ${i}` }))
			insertLTM(db, makeLTM({ type: "procedural", content: `Process ${i}` }))
		}

		const block = generateLTMBlock(db)
		expect(block).toContain("Episode")
		expect(block).toContain("Fact")
		expect(block).toContain("Process")
	})
})
