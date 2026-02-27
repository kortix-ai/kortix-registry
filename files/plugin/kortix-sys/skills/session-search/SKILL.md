---
name: session-search
description: "Search and retrieve past session data. Covers: session_list and session_get plugin tools (with TTC compression), raw SQLite queries, REST API, ripgrep/grep on legacy JSON files, and lss semantic search over session content. Load this skill when you need to: find a past session, retrieve conversation history, search across sessions by keyword, find what tool was used, look up session costs, or pull context from prior work."
---

# Session Search & Retrieval

Multiple ways to search and retrieve past session data, from high-level plugin tools to raw database queries. Pick the right approach based on what you need.

## Decision Tree

```
Need conversation content from a specific session?
  → session_get (compressed, structured)

Need to browse/filter sessions by title?
  → session_list (quick metadata scan)

Need to search INSIDE message content across sessions?
  → grep/ripgrep on legacy JSON, or SQL LIKE on messages table

Need to find sessions by semantic meaning (not exact keyword)?
  → lss over the storage directory

Need cost/token stats or complex joins?
  → Direct SQLite queries

Need to check what's running right now?
  → REST API: GET /session/status
```

---

## 1. Plugin Tools (Recommended First Choice)

Two tools provided by `kortix-sys-oc-plugin` (the unified Kortix system plugin).

### session_list

Browse sessions with metadata. No content, just IDs/titles/timestamps/stats.

```
session_list()                          # 20 most recent
session_list({ search: "auth" })        # filter by title
session_list({ limit: 50 })             # more results
```

Returns per session: ID (`ses_*`), title, created/updated timestamps, file change stats (files/additions/deletions), parent ID if subtask, plus storage paths for raw access.

### session_get

Retrieve a session's full conversation, compressed via TTC bear-1.2.

```
session_get({ session_id: "ses_abc123" })                    # default aggressiveness 0.3
session_get({ session_id: "ses_abc123", aggressiveness: 0.1 }) # light, most detail kept
session_get({ session_id: "ses_abc123", aggressiveness: 0.7 }) # heavy, just the essence
```

| Aggressiveness | Token reduction | When to use |
|---|---|---|
| 0.1 | ~10% | Recent/important sessions, need full detail |
| 0.3 | ~16% | Default — balanced |
| 0.5 | ~22% | Older sessions, broad strokes |
| 0.7+ | ~31%+ | Scanning many sessions, just need the gist |

Returns: metadata header (never compressed) + compressed conversation + tool call summaries + compression stats.

**Requires `TTC_API_KEY` env var.** If missing, returns uncompressed.

---

## 2. Raw SQLite Queries

The authoritative data store. Best for complex queries, aggregations, cost analysis.

**Database:** `/workspace/.local/share/opencode/opencode.db`

### Common Queries

```bash
# List recent sessions
sqlite3 /workspace/.local/share/opencode/opencode.db \
  "SELECT id, title, created_at FROM session ORDER BY created_at DESC LIMIT 10;"

# Find sessions by title keyword
sqlite3 /workspace/.local/share/opencode/opencode.db \
  "SELECT id, title FROM session WHERE title LIKE '%auth%';"

# Session cost summary (most expensive first)
sqlite3 /workspace/.local/share/opencode/opencode.db \
  "SELECT m.session_id, s.title, SUM(m.cost) as total_cost
   FROM message m JOIN session s ON m.session_id = s.id
   GROUP BY m.session_id ORDER BY total_cost DESC LIMIT 10;"

# Find sessions with the most tool calls
sqlite3 /workspace/.local/share/opencode/opencode.db \
  "SELECT m.session_id, s.title, COUNT(*) as tool_count
   FROM part p JOIN message m ON p.message_id = m.id JOIN session s ON m.session_id = s.id
   WHERE p.type = 'tool'
   GROUP BY m.session_id ORDER BY tool_count DESC LIMIT 10;"

# Total tokens used per session
sqlite3 /workspace/.local/share/opencode/opencode.db \
  "SELECT session_id, s.title, SUM(tokens) as total_tokens
   FROM message m JOIN session s ON m.session_id = s.id
   GROUP BY session_id ORDER BY total_tokens DESC LIMIT 10;"

# Find sessions that modified a specific file
sqlite3 /workspace/.local/share/opencode/opencode.db \
  "SELECT DISTINCT m.session_id, s.title
   FROM part p JOIN message m ON p.message_id = m.id JOIN session s ON m.session_id = s.id
   WHERE p.type = 'tool' AND p.tool = 'Write' AND p.input LIKE '%session.ts%';"
```

**Tip:** Always use read-only mode when exploring: `sqlite3 -readonly /workspace/.local/share/opencode/opencode.db`

---

## 3. REST API

Direct HTTP access to the OpenCode session API. Use via Kortix Master proxy (port 8000) or directly (port 4096).

```bash
# List all sessions
curl http://localhost:8000/session

# Get session metadata
curl http://localhost:8000/session/SESSION_ID

# Get session messages (raw, uncompressed)
curl http://localhost:8000/session/SESSION_ID/message

# Check what's running right now
curl http://localhost:8000/session/status

# Delete a session
curl -X DELETE http://localhost:8000/session/SESSION_ID
```

---

## 4. Grep/Ripgrep on Legacy JSON

Best for searching INSIDE message content across all sessions when you need exact keyword matches. Legacy JSON files mirror the SQLite data.

**Storage layout:**
```
/workspace/.local/share/opencode/storage/
├── session/global/ses_*.json     # Session metadata (id, title, timestamps)
├── message/ses_*/msg_*.json      # Messages per session (role, cost, tokens)
├── part/msg_*/prt_*.json         # Content parts per message (text, tool calls, output)
└── todo/ses_*.json               # Todo lists per session
```

### Search Examples

```bash
# Find sessions mentioning "JWT" in their title
grep -rl '"title".*JWT' /workspace/.local/share/opencode/storage/session/global/

# Find which sessions used the Write tool
grep -rl '"tool":"Write"' /workspace/.local/share/opencode/storage/part/ | head -20

# Find tool calls that wrote to a specific file
grep -rl 'middleware/auth.ts' /workspace/.local/share/opencode/storage/part/

# Find sessions where an error occurred
grep -rl '"status":"error"' /workspace/.local/share/opencode/storage/part/

# Search message text content across all sessions
grep -rl 'database migration' /workspace/.local/share/opencode/storage/part/

# Count tool calls per session (rough)
for dir in /workspace/.local/share/opencode/storage/part/msg_*/; do
  session=$(basename "$dir" | sed 's/msg_//')
  count=$(grep -l '"type":"tool"' "$dir"prt_*.json 2>/dev/null | wc -l)
  [ "$count" -gt 0 ] && echo "$count tool calls - $session"
done | sort -rn | head -10
```

**When to use grep vs SQL:** Use grep when you need to search inside raw tool outputs or message text that might not be indexed in SQLite columns. Use SQL for structured queries (costs, counts, joins).

---

## 5. Semantic Search (lss)

Use `lss` for meaning-based search when you don't know the exact keywords. lss combines BM25 full-text + embedding similarity.

```bash
# Search session files semantically
lss "authentication middleware implementation" -p /workspace/.local/share/opencode/storage/ -k 10 --json

# Scope to just session metadata
lss "database refactoring" -p /workspace/.local/share/opencode/storage/session/ -k 5 --json

# Scope to message parts (where the actual content lives)
lss "error handling for websockets" -p /workspace/.local/share/opencode/storage/part/ -k 10 --json

# Only search JSON files
lss "deployment config" -p /workspace/.local/share/opencode/storage/ -e .json -k 10 --json
```

**When to use lss vs grep:**

| Use lss | Use grep |
|---|---|
| Don't know exact keywords | Know the exact string |
| Conceptual search ("auth stuff") | Literal match (`"tool":"Write"`) |
| Want ranked results by relevance | Want all matches |
| Searching natural language content | Searching structured JSON fields |

---

## Storage Quick Reference

| What | Path |
|------|------|
| SQLite DB (primary) | `/workspace/.local/share/opencode/opencode.db` |
| Legacy JSON root | `/workspace/.local/share/opencode/storage/` |
| Session metadata | `storage/session/global/ses_*.json` |
| Messages | `storage/message/ses_*/msg_*.json` |
| Parts (text, tool calls) | `storage/part/msg_*/prt_*.json` |
| Todos | `storage/todo/ses_*.json` |
| lss index | `/workspace/.lss/` |

---

## Combining Approaches

A typical deep session search workflow:

1. **session_list** — scan titles to find candidate sessions
2. **session_get** at 0.7 — quick compressed overview of each candidate
3. **session_get** at 0.1 — full detail on the most relevant one
4. **grep** on parts — find specific tool calls or outputs you need verbatim
5. **SQL** — pull cost/token stats or cross-session aggregations
6. **lss** — when you're not finding it by keyword, search by meaning
