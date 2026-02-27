/**
 * LSS (Local Semantic Search) Companion File Writer
 *
 * Writes markdown files to a directory that the `lss` CLI tool
 * automatically indexes for hybrid BM25 + embedding search.
 *
 * File naming:
 *   obs_{id}.md         — observation files
 *   ltm_{type}_{id}.md  — long-term memory files
 */

import { mkdirSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

// ─── Constants ───────────────────────────────────────────────────────────────

// Use /workspace/.lss/kortix-mem/ — the .lss dir is pre-created by the Dockerfile
// and watched by the lss-sync service for semantic search indexing.
const BASE_DIR = process.env.KORTIX_WORKSPACE ?? process.env.HOME ?? os.homedir()
const DEFAULT_MEM_DIR = path.join(BASE_DIR, ".lss", "kortix-mem")

// ─── Directory Management ────────────────────────────────────────────────────

export function ensureMemDir(dir?: string): string {
	const d = dir ?? DEFAULT_MEM_DIR
	mkdirSync(d, { recursive: true })
	return d
}

// ─── Observation Files ───────────────────────────────────────────────────────

export function writeObservationFile(
	dir: string,
	id: number,
	data: {
		title: string
		narrative: string
		type: string
		facts: string[]
		concepts: string[]
		filesRead: string[]
		filesModified: string[]
	},
): void {
	const filename = `obs_${id}.md`
	const lines: string[] = [
		`# ${data.title}`,
		"",
		`Type: ${data.type}`,
		"",
		data.narrative,
	]

	if (data.facts.length > 0) {
		lines.push("")
		lines.push("## Facts")
		for (const f of data.facts) {
			lines.push(`- ${f}`)
		}
	}

	if (data.concepts.length > 0) {
		lines.push("")
		lines.push(`Tags: ${data.concepts.join(", ")}`)
	}

	const allFiles = [...data.filesRead, ...data.filesModified]
	if (allFiles.length > 0) {
		lines.push("")
		lines.push(`Files: ${allFiles.join(", ")}`)
	}

	writeFileSync(path.join(dir, filename), lines.join("\n"), "utf-8")
}

// ─── LTM Files ───────────────────────────────────────────────────────────────

export function writeLTMFile(
	dir: string,
	id: number,
	type: string,
	content: string,
	tags: string[],
): void {
	const filename = `ltm_${type}_${id}.md`
	const lines: string[] = [
		`# [${type}] Memory #${id}`,
		"",
		content,
	]

	if (tags.length > 0) {
		lines.push("")
		lines.push(`Tags: ${tags.join(", ")}`)
	}

	writeFileSync(path.join(dir, filename), lines.join("\n"), "utf-8")
}
