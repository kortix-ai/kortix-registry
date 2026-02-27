/**
 * Tests for session helpers — formatMessages, truncate, shortTs, changeSummary, ttcCompress
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test"
import { truncate, shortTs, changeSummary, formatMessages, ttcCompress } from "../src/session"
import type { Session, Message, Part, ToolPart, ToolStateCompleted, ToolStateError, TextPart } from "@opencode-ai/sdk"

// ─── truncate ────────────────────────────────────────────────────────────────

describe("truncate", () => {
	it("returns short strings unchanged", () => {
		expect(truncate("hello", 100)).toBe("hello")
	})

	it("truncates long strings with omission marker", () => {
		const long = "a".repeat(500)
		const result = truncate(long, 100)
		expect(result.length).toBeLessThan(500)
		expect(result).toContain("chars omitted")
	})

	it("preserves head and tail", () => {
		const str = "HEAD_START" + "x".repeat(500) + "TAIL_END"
		const result = truncate(str, 100)
		expect(result).toContain("HEAD_")
		expect(result).toContain("_END")
	})
})

// ─── shortTs ─────────────────────────────────────────────────────────────────

describe("shortTs", () => {
	it("formats epoch ms to short timestamp", () => {
		// 2025-06-15T10:30:00.000Z
		const ts = new Date("2025-06-15T10:30:00Z").getTime()
		expect(shortTs(ts)).toBe("2025-06-15 10:30")
	})

	it("drops seconds and milliseconds", () => {
		const ts = new Date("2025-01-01T23:59:59.999Z").getTime()
		expect(shortTs(ts)).toBe("2025-01-01 23:59")
	})
})

// ─── changeSummary ───────────────────────────────────────────────────────────

describe("changeSummary", () => {
	it("returns 'no file changes' for sessions without summary", () => {
		const s = { summary: undefined } as unknown as Session
		expect(changeSummary(s)).toBe("no file changes")
	})

	it("formats file change summary", () => {
		const s = {
			summary: { files: 5, additions: 120, deletions: 30 },
		} as unknown as Session
		expect(changeSummary(s)).toBe("5 files (+120, -30)")
	})
})

// ─── formatMessages ──────────────────────────────────────────────────────────

describe("formatMessages", () => {
	function makeMsg(role: "user" | "assistant", parts: Part[]): { info: Message; parts: Part[] } {
		return {
			info: { role } as Message,
			parts,
		}
	}

	it("formats user and assistant text", () => {
		const messages = [
			makeMsg("user", [{ type: "text", text: "Hello" } as TextPart]),
			makeMsg("assistant", [{ type: "text", text: "Hi there" } as TextPart]),
		]
		const result = formatMessages(messages)
		expect(result).toContain("USER: Hello")
		expect(result).toContain("ASSISTANT: Hi there")
	})

	it("skips synthetic and ignored text parts", () => {
		const messages = [
			makeMsg("user", [
				{ type: "text", text: "visible" } as TextPart,
				{ type: "text", text: "synthetic", synthetic: true } as any,
				{ type: "text", text: "ignored", ignored: true } as any,
			]),
		]
		const result = formatMessages(messages)
		expect(result).toContain("visible")
		expect(result).not.toContain("synthetic")
		expect(result).not.toContain("ignored")
	})

	it("formats completed tool calls with truncated I/O", () => {
		const messages = [
			makeMsg("assistant", [
				{
					type: "tool",
					tool: "read",
					state: {
						status: "completed",
						input: { filePath: "/src/index.ts" },
						output: "file content here",
						title: "",
						metadata: {},
						time: { start: 0, end: 0 },
					} as unknown as ToolStateCompleted,
				} as unknown as ToolPart,
			]),
		]
		const result = formatMessages(messages)
		expect(result).toContain("TOOL [read]:")
		expect(result).toContain("filePath")
		expect(result).toContain("file content here")
	})

	it("formats errored tool calls", () => {
		const messages = [
			makeMsg("assistant", [
				{
					type: "tool",
					tool: "bash",
					state: {
						status: "error",
						error: "command not found",
					} as ToolStateError,
				} as unknown as ToolPart,
			]),
		]
		const result = formatMessages(messages)
		expect(result).toContain("TOOL [bash] ERROR:")
		expect(result).toContain("command not found")
	})

	it("skips non-text, non-tool parts", () => {
		const messages = [
			makeMsg("assistant", [
				{ type: "reasoning" } as any,
				{ type: "step-start" } as any,
				{ type: "text", text: "visible" } as TextPart,
			]),
		]
		const result = formatMessages(messages)
		expect(result).toBe("ASSISTANT: visible")
	})
})

// ─── ttcCompress ─────────────────────────────────────────────────────────────

describe("ttcCompress", () => {
	let originalFetch: typeof globalThis.fetch

	beforeEach(() => {
		originalFetch = globalThis.fetch
	})

	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	it("returns compressed output on success", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						output: "compressed text",
						original_input_tokens: 100,
						output_tokens: 70,
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			),
		) as any

		const result = await ttcCompress("some long text", 0.3, "test-key")
		expect(result.output).toBe("compressed text")
		expect(result.originalTokens).toBe(100)
		expect(result.compressedTokens).toBe(70)
	})

	it("returns original text on API error", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(new Response("Internal Server Error", { status: 500 })),
		) as any

		const result = await ttcCompress("original text", 0.3, "test-key")
		expect(result.output).toBe("original text")
		expect(result.originalTokens).toBe(0)
	})

	it("returns original text on network failure", async () => {
		globalThis.fetch = mock(() => Promise.reject(new Error("network down"))) as any

		const result = await ttcCompress("original text", 0.3, "test-key")
		expect(result.output).toBe("original text")
		expect(result.originalTokens).toBe(0)
	})
})
