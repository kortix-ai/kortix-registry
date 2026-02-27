import { describe, it, expect } from "bun:test"
import { extractObservation, SKIP_TOOLS } from "../src/extract"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extract(tool: string, args: Record<string, unknown>, output = "ok", title?: string) {
	return extractObservation({ tool, args, output, title }, "ses_test", 1)
}

// ─── Skip List ───────────────────────────────────────────────────────────────

describe("skip list", () => {
	it("skips mem_search", () => {
		expect(extract("mem_search", { query: "foo" })).toBeNull()
	})

	it("skips mem_save", () => {
		expect(extract("mem_save", { text: "foo" })).toBeNull()
	})

	it("skips TodoWrite", () => {
		expect(extract("TodoWrite", {})).toBeNull()
	})

	it("skips pty_list", () => {
		expect(extract("pty_list", {})).toBeNull()
	})

	it("does not skip read", () => {
		expect(extract("read", { filePath: "/foo" })).not.toBeNull()
	})
})

// ─── Read ────────────────────────────────────────────────────────────────────

describe("read extractor", () => {
	it("extracts read observation", () => {
		const obs = extract("read", { filePath: "/src/auth/middleware.ts" })
		expect(obs).not.toBeNull()
		expect(obs!.type).toBe("discovery")
		expect(obs!.title).toContain("middleware.ts")
		expect(obs!.filesRead).toEqual(["/src/auth/middleware.ts"])
		expect(obs!.filesModified).toEqual([])
		expect(obs!.toolName).toBe("read")
	})

	it("handles Read (capitalized)", () => {
		const obs = extract("Read", { filePath: "/src/foo.ts" })
		expect(obs).not.toBeNull()
		expect(obs!.type).toBe("discovery")
	})

	it("handles missing path gracefully", () => {
		const obs = extract("read", {})
		expect(obs).not.toBeNull()
		expect(obs!.title).toContain("file")
	})
})

// ─── Write ───────────────────────────────────────────────────────────────────

describe("write extractor", () => {
	it("extracts write observation", () => {
		const obs = extract("write", { filePath: "/src/new-feature.ts" })
		expect(obs).not.toBeNull()
		expect(obs!.type).toBe("feature")
		expect(obs!.filesModified).toEqual(["/src/new-feature.ts"])
		expect(obs!.filesRead).toEqual([])
	})

	it("handles Write (capitalized)", () => {
		const obs = extract("Write", { filePath: "/foo.ts" })
		expect(obs).not.toBeNull()
	})
})

// ─── Edit ────────────────────────────────────────────────────────────────────

describe("edit extractor", () => {
	it("classifies as change by default", () => {
		const obs = extract("edit", {
			filePath: "/src/app.ts",
			oldString: "const x = 1",
			newString: "const x = 2",
		})
		expect(obs).not.toBeNull()
		expect(obs!.type).toBe("change")
		expect(obs!.filesModified).toEqual(["/src/app.ts"])
	})

	it("classifies as bugfix when fix-related words present", () => {
		const obs = extract("edit", {
			filePath: "/src/app.ts",
			oldString: "broken code",
			newString: "fix the error",
		})
		expect(obs!.type).toBe("bugfix")
	})

	it("classifies as refactor when refactor-related words present", () => {
		const obs = extract("edit", {
			filePath: "/src/app.ts",
			oldString: "rename oldFunc",
			newString: "rename newFunc",
		})
		expect(obs!.type).toBe("refactor")
	})

	it("records old → new fact", () => {
		const obs = extract("edit", {
			filePath: "/src/app.ts",
			oldString: "port = 3000",
			newString: "port = 8080",
		})
		expect(obs!.facts.length).toBeGreaterThan(0)
		expect(obs!.facts[0]).toContain("3000")
		expect(obs!.facts[0]).toContain("8080")
	})
})

// ─── Bash ────────────────────────────────────────────────────────────────────

describe("bash extractor", () => {
	it("classifies git commands", () => {
		const obs = extract("bash", { command: "git status" })
		expect(obs!.type).toBe("change")
		expect(obs!.title).toContain("git")
		expect(obs!.concepts).toContain("git")
	})

	it("classifies npm install", () => {
		const obs = extract("bash", { command: "npm install express" })
		expect(obs!.type).toBe("change")
		expect(obs!.concepts).toContain("packages")
	})

	it("classifies test runs — passing", () => {
		const obs = extract("bash", { command: "bun test" }, "3 pass 0 fail")
		expect(obs!.type).toBe("discovery")
		expect(obs!.title).toContain("Tests")
	})

	it("classifies test runs — failing", () => {
		const obs = extract("bash", { command: "npm test" }, "FAIL 2 tests")
		expect(obs!.type).toBe("bugfix")
	})

	it("classifies docker commands", () => {
		const obs = extract("bash", { command: "docker compose up" })
		expect(obs!.concepts).toContain("docker")
	})

	it("classifies HTTP commands", () => {
		const obs = extract("bash", { command: "curl https://api.example.com" })
		expect(obs!.concepts).toContain("http")
	})

	it("classifies filesystem commands", () => {
		const obs = extract("bash", { command: "mkdir -p /src/new" })
		expect(obs!.concepts).toContain("filesystem")
	})

	it("falls back to generic bash", () => {
		const obs = extract("bash", { command: "echo hello" })
		expect(obs!.concepts).toContain("bash")
	})

	it("records command in narrative", () => {
		const obs = extract("bash", { command: "ls -la" })
		expect(obs!.narrative).toContain("ls -la")
	})
})

// ─── Grep ────────────────────────────────────────────────────────────────────

describe("grep extractor", () => {
	it("extracts search pattern", () => {
		const obs = extract("grep", { pattern: "TODO" }, "file1.ts:3\nfile2.ts:10\n")
		expect(obs!.type).toBe("discovery")
		expect(obs!.title).toContain("TODO")
		expect(obs!.concepts).toContain("search")
	})
})

// ─── Glob ────────────────────────────────────────────────────────────────────

describe("glob extractor", () => {
	it("extracts glob pattern", () => {
		const obs = extract("glob", { pattern: "**/*.ts" }, "a.ts\nb.ts\nc.ts\n")
		expect(obs!.type).toBe("discovery")
		expect(obs!.title).toContain("**/*.ts")
	})
})

// ─── Web Search ──────────────────────────────────────────────────────────────

describe("web search extractor", () => {
	it("extracts search query", () => {
		const obs = extract("web_search", { query: "bun sqlite FTS5" })
		expect(obs!.type).toBe("discovery")
		expect(obs!.title).toContain("bun sqlite FTS5")
		expect(obs!.concepts).toContain("web-search")
	})

	it("handles web-search (hyphenated)", () => {
		const obs = extract("web-search", { query: "test" })
		expect(obs).not.toBeNull()
	})
})

// ─── Generic ─────────────────────────────────────────────────────────────────

describe("generic extractor", () => {
	it("handles unknown tools", () => {
		const obs = extract("some_custom_tool", { foo: "bar" })
		expect(obs).not.toBeNull()
		expect(obs!.type).toBe("discovery")
		expect(obs!.title).toContain("some_custom_tool")
	})

	it("uses title from metadata if available", () => {
		const obs = extract("some_tool", { foo: "bar" }, "ok", "Custom title")
		expect(obs!.title).toBe("Custom title")
	})
})

// ─── Privacy ─────────────────────────────────────────────────────────────────

describe("privacy", () => {
	it("strips <private> tags from args", () => {
		const obs = extract("read", { filePath: "<private>secret</private>/public.ts" })
		expect(obs!.filesRead[0]).not.toContain("secret")
		expect(obs!.filesRead[0]).toContain("[REDACTED]")
	})

	it("strips <private> tags from output", () => {
		const obs = extract("bash", { command: "echo hi" }, "token: <private>abc123</private>")
		expect(obs!.facts[0]).not.toContain("abc123")
		expect(obs!.facts[0]).toContain("[REDACTED]")
	})
})

// ─── Session / Prompt ────────────────────────────────────────────────────────

describe("session context", () => {
	it("passes session ID through", () => {
		const obs = extractObservation(
			{ tool: "read", args: { filePath: "/foo" }, output: "ok" },
			"ses_custom",
			5,
		)
		expect(obs!.sessionId).toBe("ses_custom")
		expect(obs!.promptNumber).toBe(5)
	})
})
