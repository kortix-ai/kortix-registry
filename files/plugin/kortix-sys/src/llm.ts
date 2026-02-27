/**
 * Shared LLM Infrastructure
 *
 * Provides a unified interface for calling LLMs via:
 *   1. Kortix router (OpenAI-compatible) — KORTIX_API_URL + KORTIX_TOKEN
 *   2. Anthropic Messages API — ANTHROPIC_API_KEY (fallback)
 *
 * Used by both the consolidation engine and per-observation enrichment.
 */

import type { LogFn } from "./types"

// ─── Constants ───────────────────────────────────────────────────────────────

export const KORTIX_MODEL = "kortix/basic"
export const ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929"
export const DEFAULT_MAX_TOKENS = 2000
const ANTHROPIC_VERSION = "2023-06-01"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LLMConfig {
	type: "kortix" | "anthropic"
	baseURL: string
	apiKey: string
	model: string
}

export interface LLMOptions {
	kortixUrl?: string
	kortixToken?: string
	anthropicKey?: string
	anthropicBaseUrl?: string
	model?: string
	maxTokens?: number
}

// ─── Provider Resolution ─────────────────────────────────────────────────────

/**
 * Resolve the best available LLM provider from options + environment.
 * Returns null if no provider is configured.
 */
export function resolveLLMConfig(opts?: LLMOptions): LLMConfig | null {
	// Priority 1: Kortix router
	const kortixUrl = opts?.kortixUrl ?? process.env.KORTIX_API_URL
	const kortixToken = opts?.kortixToken ?? process.env.KORTIX_TOKEN
	if (kortixUrl && kortixToken) {
		return {
			type: "kortix",
			baseURL: kortixUrl.replace(/\/+$/, ""),
			apiKey: kortixToken,
			model: opts?.model ?? KORTIX_MODEL,
		}
	}

	// Priority 2: Anthropic API
	const anthropicKey = opts?.anthropicKey ?? process.env.ANTHROPIC_API_KEY
	if (anthropicKey) {
		const baseURL = (opts?.anthropicBaseUrl ?? process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/+$/, "")
		return {
			type: "anthropic",
			baseURL,
			apiKey: anthropicKey,
			model: opts?.model ?? ANTHROPIC_MODEL,
		}
	}

	return null
}

// ─── LLM Call ────────────────────────────────────────────────────────────────

/**
 * Call an LLM with the given system prompt and user message.
 * Routes to the correct provider based on config.type.
 * Returns the raw text response or null on error.
 */
export async function callLLM(
	config: LLMConfig,
	system: string,
	userMessage: string,
	log: LogFn,
	maxTokens?: number,
): Promise<string | null> {
	try {
		if (config.type === "kortix") {
			return await callOpenAICompatible(config, system, userMessage, log, maxTokens)
		} else {
			return await callAnthropicAPI(config, system, userMessage, log, maxTokens)
		}
	} catch (err) {
		log("warn", `[memory:llm] LLM call failed: ${err}`)
		return null
	}
}

// ─── Provider Implementations ────────────────────────────────────────────────

async function callOpenAICompatible(
	config: LLMConfig,
	system: string,
	userMessage: string,
	log: LogFn,
	maxTokens?: number,
): Promise<string | null> {
	const url = `${config.baseURL}/chat/completions`
	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Authorization": `Bearer ${config.apiKey}`,
		},
		body: JSON.stringify({
			model: config.model,
			max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: userMessage },
			],
		}),
	})

	if (!response.ok) {
		const text = await response.text().catch(() => "")
		log("warn", `[memory:llm] Kortix API error ${response.status}: ${text.slice(0, 200)}`)
		return null
	}

	const data = await response.json() as any
	const text = data?.choices?.[0]?.message?.content
	return text?.trim() ?? null
}

async function callAnthropicAPI(
	config: LLMConfig,
	system: string,
	userMessage: string,
	log: LogFn,
	maxTokens?: number,
): Promise<string | null> {
	const url = `${config.baseURL}/v1/messages`
	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": config.apiKey,
			"anthropic-version": ANTHROPIC_VERSION,
		},
		body: JSON.stringify({
			model: config.model,
			max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
			system,
			messages: [{ role: "user", content: userMessage }],
		}),
	})

	if (!response.ok) {
		const text = await response.text().catch(() => "")
		log("warn", `[memory:llm] Anthropic API error ${response.status}: ${text.slice(0, 200)}`)
		return null
	}

	const data = await response.json() as any
	const text = data?.content?.[0]?.text
	return text?.trim() ?? null
}

// ─── JSON Extraction Helper ──────────────────────────────────────────────────

/**
 * Extract JSON from an LLM response that may contain markdown fences or preamble.
 */
export function extractJson(text: string): string {
	const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
	if (fenceMatch?.[1]) return fenceMatch[1].trim()
	const objMatch = text.match(/\{[\s\S]*\}/)
	if (objMatch) return objMatch[0]
	return text
}
