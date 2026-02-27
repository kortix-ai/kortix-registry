# kortix-sys-oc-plugin

Long-term memory plugin for [OpenCode](https://opencode.ai). Ensures no important information is ever lost across sessions or compaction events.

## How It Works

The plugin operates on two layers:

**Observations** (short-term) — Every tool the agent executes is automatically logged as a structured observation. These are the raw event log: "Read file X", "Edited line 42", "Ran git status". Observations are internal plumbing — they feed the consolidation process and are searchable via `mem_search`, but never auto-injected into context.

**Long-Term Memory** (durable) — During compaction, an LLM reads the session's observations and distills them into categorized memories:

| Type | What it captures | Example |
|------|-----------------|---------|
| **Episodic** | What happened — events, tasks, outcomes | "Built JWT auth system for the Express API" |
| **Semantic** | What is known — facts, architecture, patterns | "Frontend uses SolidJS + Tailwind at apps/frontend/" |
| **Procedural** | How to do things — workflows, commands | "Deploy: bun build → docker compose up -d" |

LTM is automatically injected into every conversation via the latest user message (never the system prompt — preserving KV cache).

## Architecture

```
Agent works on tasks
  │
  ├─ tool.execute.after ──→ SAVE observation (automatic, every tool call)
  │
  ├─ messages.transform ──→ RECALL: inject <long-term-memory> into user message
  │                          (automatic, every LLM call, cache-safe)
  │
  ├─ agent calls mem_search() ──→ SEARCH: explicit query across observations + LTM
  │
  └─ context hits 90% ──→ COMPACTION fires:
          │
          ├─ 1. LLM consolidation: observations → episodic/semantic/procedural
          ├─ 2. Store new LTM entries in SQLite + LSS files
          ├─ 3. Reinforce re-encountered facts (bump confidence)
          ├─ 4. Inject LTM block into compaction context
          └─ 5. Session resets — LTM persists forever
```

## Installation

### From npm (once published)

```bash
bun add kortix-sys-oc-plugin
```

### From local path

Reference the plugin directly in your `opencode.jsonc`:

```jsonc
{
  "plugin": ["./path/to/kortix-sys-oc-plugin/src/index.ts"]
}
```

### From npm package name

```jsonc
{
  "plugin": ["kortix-sys-oc-plugin"]
}
```

## Configuration

### Environment Variables

The plugin works without any env vars for basic memory (observations + search). LLM consolidation during compaction requires at least one provider:

| Variable | Required | Description |
|----------|----------|-------------|
| `KORTIX_API_URL` | No | Kortix router URL (OpenAI-compatible). Priority 1 for consolidation. |
| `KORTIX_TOKEN` | No | Kortix auth token. Used with `KORTIX_API_URL`. |
| `ANTHROPIC_API_KEY` | No | Anthropic API key. Fallback for consolidation when Kortix is unavailable. |
| `ANTHROPIC_BASE_URL` | No | Override Anthropic API base URL (default: `https://api.anthropic.com`). |

### OpenCode Config

```jsonc
// opencode.jsonc
{
  "plugin": ["kortix-sys-oc-plugin"]
}
```

No additional plugin configuration is needed. The plugin auto-initializes its SQLite database and LSS directory.

## Agent Tools

### `mem_search`

Search across all memory stores — both LTM and raw observations. LTM results are ranked higher.

```
mem_search(query: string, limit?: number, source?: "both" | "ltm" | "observation")
```

### `mem_save`

Manually save an important fact, insight, or workflow to long-term memory.

```
mem_save(text: string, type?: "episodic" | "semantic" | "procedural", tags?: string)
```

## Cache Safety

The LTM block is injected into the **latest user message** via `experimental.chat.messages.transform`, NOT into the system prompt. This preserves the KV cache:

- System prompt → **stable, cached**
- Historical turns → **stable, cached**
- Latest user message → always new, includes `<long-term-memory>` block

## Database

SQLite database at `~/.kortix/memory.db` with WAL mode.

### Tables

- `observations` — raw tool execution events + FTS5 index
- `long_term_memories` — consolidated episodic/semantic/procedural memories + FTS5 index
- `session_meta` — session tracking and consolidation state

### LSS Files

Written to `~/.kortix/mem/` for semantic search via the `lss` CLI:
- `obs_{id}.md` — observation files
- `ltm_{type}_{id}.md` — long-term memory files

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Type check
bun x tsc --noEmit
```

### Test Structure

| File | Coverage |
|------|----------|
| `test/db.test.ts` | SQLite CRUD, FTS5 search, unified search, session meta |
| `test/extract.test.ts` | Observation extraction for all tool types |
| `test/context.test.ts` | LTM block formatting and limits |
| `test/consolidate.test.ts` | LLM consolidation with mocked fetch |
| `test/lss.test.ts` | LSS companion file writing |

## License

MIT
