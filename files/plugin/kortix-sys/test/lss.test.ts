import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, readFileSync, rmSync, mkdirSync } from "node:fs"
import { writeObservationFile, writeLTMFile, ensureMemDir } from "../src/lss"

const TEST_DIR = "/tmp/kortix-memory-lss-test"

beforeEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
})

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
})

describe("ensureMemDir", () => {
	it("creates the directory if it does not exist", () => {
		ensureMemDir(TEST_DIR)
		expect(existsSync(TEST_DIR)).toBe(true)
	})

	it("does not throw if directory already exists", () => {
		mkdirSync(TEST_DIR, { recursive: true })
		expect(() => ensureMemDir(TEST_DIR)).not.toThrow()
	})
})

describe("writeObservationFile", () => {
	it("writes obs_{id}.md file", () => {
		ensureMemDir(TEST_DIR)
		writeObservationFile(TEST_DIR, 42, {
			title: "Read auth middleware",
			narrative: "Read /src/auth/middleware.ts to understand JWT handling",
			type: "discovery",
			facts: ["Uses refresh tokens"],
			concepts: ["auth", "jwt"],
			filesRead: ["/src/auth/middleware.ts"],
			filesModified: [],
		})

		const filePath = `${TEST_DIR}/obs_42.md`
		expect(existsSync(filePath)).toBe(true)

		const content = readFileSync(filePath, "utf-8")
		expect(content).toContain("Read auth middleware")
		expect(content).toContain("JWT handling")
		expect(content).toContain("auth")
	})
})

describe("writeLTMFile", () => {
	it("writes ltm_{type}_{id}.md file", () => {
		ensureMemDir(TEST_DIR)
		writeLTMFile(TEST_DIR, 7, "semantic", "The API uses JWT refresh tokens", ["auth", "jwt"])

		const filePath = `${TEST_DIR}/ltm_semantic_7.md`
		expect(existsSync(filePath)).toBe(true)

		const content = readFileSync(filePath, "utf-8")
		expect(content).toContain("JWT refresh tokens")
		expect(content).toContain("semantic")
		expect(content).toContain("auth")
	})

	it("handles different LTM types", () => {
		ensureMemDir(TEST_DIR)
		writeLTMFile(TEST_DIR, 1, "episodic", "Built auth system", ["auth"])
		writeLTMFile(TEST_DIR, 2, "procedural", "Deploy: bun build", ["deploy"])

		expect(existsSync(`${TEST_DIR}/ltm_episodic_1.md`)).toBe(true)
		expect(existsSync(`${TEST_DIR}/ltm_procedural_2.md`)).toBe(true)
	})
})
