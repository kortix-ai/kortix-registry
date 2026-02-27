---
name: memory-context-management
description: "Memory, context, and persistent knowledge management for the Kortix agent. Covers: kortix-sys-oc-plugin (observations, LTM consolidation, mem_search, mem_save, session_list, session_get), filesystem persistence rules, using .MD files for plans/notes/project state, how filesystem writes feed the memory pipeline, and best practices for ensuring nothing important is ever lost. Load this skill when you need to: understand how your memory works, decide where to persist information, write plans or notes, manage project context across sessions, or optimize your context window usage."
---

# Memory & Context Management

Two complementary systems for retaining knowledge across sessions: the **memory plugin** (automatic, SQLite) and the **persistent filesystem** (manual, disk). Use both.

## Core Facts

1. **The filesystem is forever persistent.** `/workspace` survives container restarts, rebuilds, reboots. Anything written there is permanent until explicitly deleted.
2. **You are always in a session.** The memory plugin injects your session ID on every turn via `<session_context>`. Use it for traceability.
3. **Organize your files.** Don't scatter loose docs everywhere — keep things tidy within the project or in a sensible location. Use your judgement.

---

## 1. Session Awareness

Every turn, the memory plugin injects your current session ID:

```xml
<session_context>
Session ID: ses_abc123
</session_context>
```

Use this for:
- Traceability in notes ("Continued from ses_abc123")
- Searching past work via `mem_search` or `session_get`
- Linking your observations and LTM back to sessions

---

## 2. Filesystem Persistence

The filesystem is your most reliable long-term storage. Write `.md` files for anything that should survive across sessions.

### What to Persist

- **Plans** — before starting complex multi-step work
- **Progress** — track what's done and what's next
- **Handoff notes** — when work will continue in another session
- **Decisions** — architectural choices with rationale
- **Findings** — research results, debugging discoveries, gotchas

### Guidelines

- **Write plans before building.** Forces clear thinking, gives future sessions instant context.
- **Update as you go.** Don't batch updates — write after each milestone.
- **Include session IDs and dates** in notes for traceability.
- **Append over overwrite** — preserves history.
- **Keep it scannable.** Short bullets, checklists, `file:line` references — not essays.
- **Organize sensibly.** Keep notes close to the project they belong to. Don't pollute unrelated directories.

### Why This Matters

- **Sessions end.** Conversation context is gone. Files remain.
- **Compaction happens.** Older messages get compressed. Files remain.
- **Other sessions can read your files.** A future session can pick up exactly where you left off.
- **File writes feed the memory pipeline.** Every file you write generates an observation that feeds into LTM consolidation.

---

## 3. The Memory Plugin (kortix-sys-oc-plugin)

Automatic system that captures, consolidates, and recalls knowledge.

### How It Works

```
You work normally (read files, write code, run commands, search)
         │
         ▼
   Observations (automatic)
   Every tool call → structured observation:
   - File reads/writes, bash commands, searches, grep/glob
         │
         ▼
   Stored in SQLite (~/.kortix/memory.db), searchable via mem_search
         │
         ▼
   Compaction triggers LTM consolidation
   - LLM reads session observations
   - Extracts episodic/semantic/procedural memories
   - Deduplicates against existing LTM
   - Stores in long_term_memories table
         │
         ▼
   LTM auto-recalled every turn
   Relevant memories injected into context automatically.
```

### Tools

**mem_search** — Search observations + LTM. LTM ranked higher.

```
mem_search({ query: "how we set up the auth system" })
mem_search({ query: "database schema for users table" })
```

**mem_save** — Manually persist to LTM. Use sparingly — the auto-pipeline handles most cases.

```
mem_save({ text: "User prefers Bun over Node", type: "semantic" })
```

### Memory Categories

| Category | What | Example |
|---|---|---|
| **Episodic** | Events | "Migrated DB from Postgres to SQLite on Jan 15" |
| **Semantic** | Facts | "API rate limit is 100 req/min per user" |
| **Procedural** | How-to | "Deploy: `bun build` then `bun run deploy`" |

---

## 4. How Filesystem + Memory Reinforce Each Other

Writing files feeds the memory pipeline:

```
You write a plan file
    │
    ├── File on disk permanently (ground truth)
    │
    └── Write → observation → compaction → LTM → auto-recalled
```

| System | Strength | Best for |
|---|---|---|
| **Filesystem** | Full fidelity, any session can read it | Plans, progress, detailed notes |
| **Memory plugin** | Auto-surfaces relevant knowledge | Ambient context, cross-session recall |

**Rule of thumb:** If a future session might need to `cat` the info, write a file. If it's ambient context that should surface automatically, let the memory plugin handle it. For critical items, do both.

---

## 5. Context Window Management

When the context window fills, **compaction** fires — older messages are compressed, observations are consolidated into LTM.

### Rules

1. **Don't keep large file contents in conversation.** Read, act, move on.
2. **Don't repeat yourself.** Reference files instead of re-stating.
3. **Persist early.** Write important context to disk so it survives compaction.
4. **Search before re-investigating.** `mem_search` first — you may have already solved this.
5. **Write handoff notes proactively.** After milestones, not just at session end.

**Nothing is truly lost** if you persist to disk and let the memory plugin do its job.
