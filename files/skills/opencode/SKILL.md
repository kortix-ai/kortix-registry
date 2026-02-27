---
name: opencode
description: "In-depth reference for how OpenCode works — the AI agent framework that powers this environment. Covers: agents (definition, loading, modes, model assignment), skills (discovery, loading, structure), tools (built-in + custom, permissions), commands (slash commands, frontmatter, routing), sessions (lifecycle, prompting, subagents), config (opencode.jsonc, providers, MCP servers, plugins), and the full REST/SSE API. Load this skill when you need to understand OpenCode internals, debug agent/tool/skill issues, extend the framework, create custom tools, or work with the session API."
---

# OpenCode — Agent Framework Reference

OpenCode is the AI agent framework running this environment. It manages agents, skills, tools, commands, sessions, providers, and plugins. Everything is configured via files in the config directory (`/opt/opencode/` in the Kortix sandbox, or `.opencode/` in a project).

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│  OpenCode                                            │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │  Agents   │  │  Skills   │  │  Tools    │          │
│  │ (.md)     │  │ (SKILL.md)│  │ (.ts)     │          │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘          │
│       │              │              │                 │
│  ┌────▼──────────────▼──────────────▼─────┐          │
│  │              Session Engine              │          │
│  │  (prompt → model → tool calls → text)   │          │
│  └────────────────┬───────────────────────┘          │
│                   │                                   │
│  ┌────────────────▼───────────────────────┐          │
│  │            Provider Layer               │          │
│  │  (Anthropic, OpenAI, Kortix router)     │          │
│  └────────────────────────────────────────┘          │
│                                                      │
│  Config: opencode.jsonc  │  Plugins  │  MCP Servers  │
└─────────────────────────────────────────────────────┘
```

---

## Agents

### What is an Agent?

An agent is a **persona** — a system prompt combined with permission rules, model preferences, and behavioral constraints. Defined as `.md` files with YAML frontmatter.

### Agent Definition File

Location: `agents/*.md` or `agents/**/*.md` in the config directory.

```markdown
---
description: "Short description shown in UI and Task tool"
model: provider/model-id
mode: primary
permission:
  bash: allow
  edit: allow
  read: allow
  task: allow
  skill: allow
  # ... tool permissions
---

# Agent Name

System prompt content goes here. This entire markdown body
becomes the agent's system prompt.
```

### Frontmatter Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `description` | string | Yes | Shown in UI and Task tool agent list |
| `mode` | `primary` / `subagent` / `all` | Yes | Controls where the agent appears |
| `model` | string | No | Default model as `provider/model-id` (e.g., `anthropic/claude-opus-4-6`) |
| `permission` | object | No | Tool permission rules (`allow` / `deny` per tool name) |
| `temperature` | number | No | Model temperature |
| `topP` | number | No | Top-P sampling |
| `steps` | number | No | Max tool-use steps per turn |
| `hidden` | boolean | No | Hide from UI |

### Agent Modes

| Mode | User-selectable | Task tool | Use case |
|---|---|---|---|
| `primary` | Yes | Hidden from list, but **can be spawned by name** | Main agent the user interacts with |
| `subagent` | No | Listed and spawnable | Specialist agents for Task tool delegation |
| `all` | Yes | Yes | Available everywhere |

**Key insight:** The Task tool's description filters out `primary` mode agents (`a.mode !== "primary"`), but `Agent.get()` (the execution path) has **no mode guard**. A primary agent CAN self-spawn by name via `subagent_type: "agent-name"`.

### Agent Name Derivation

The agent name is the **filename without `.md`**. For nested paths, only the filename matters:
- `agents/kortix.md` → name: `kortix`
- `agents/specialised/my-agent.md` → name: `my-agent`

### Agent Loading Order

1. Built-in agents (compaction, title, summary — hidden infrastructure)
2. Config directory agents (`agents/*.md`)
3. Config overrides from `opencode.jsonc` `"agent"` section (can disable built-in agents)

### Disabling Built-in Agents

In `opencode.jsonc`:
```json
{
  "agent": {
    "build": { "disable": true },
    "plan": { "disable": true },
    "explore": { "disable": true },
    "general": { "disable": true }
  }
}
```

### Agent Permission System

Permissions control which tools an agent can use. Rules are evaluated per-tool-call:

```yaml
permission:
  bash: allow       # Allow all bash commands
  edit: allow       # Allow file editing
  task: allow       # Allow spawning subagents
  skill: allow      # Allow loading skills
  web-search: allow # Allow web search tool
```

Subagent sessions inherit parent permissions but can have additional restrictions. The Task tool hardcodes `todowrite: deny` and `todoread: deny` for all subagent sessions (lines 77-82 of task.ts).

---

## Skills

### What is a Skill?

A skill is a **knowledge package** — domain-specific instructions, workflows, and resources that inject into the agent's context when loaded via the `skill()` tool. Skills transform a general-purpose agent into a specialist on demand.

### Skill Structure

```
skill-name/
├── SKILL.md          # Required: frontmatter + instructions
├── scripts/          # Optional: executable code
├── references/       # Optional: supplementary docs
└── assets/           # Optional: templates, images
```

### SKILL.md Format

```markdown
---
name: my-skill
description: "Detailed description of when to load this skill. Include trigger phrases."
---

# Skill Title

Instructions loaded into context when the skill is triggered.
These become part of the agent's working knowledge.
```

**Frontmatter fields:**
| Field | Required | Description |
|---|---|---|
| `name` | Yes | Skill identifier (used in `skill({ name: "..." })`) |
| `description` | Yes | Trigger description — the agent reads this to decide when to load the skill |

### Skill Discovery

Skills are discovered from multiple locations (loaded in order, later overwrites earlier):

1. **Global external dirs:** `~/.claude/skills/**/SKILL.md`, `~/.agents/skills/**/SKILL.md`
2. **Project external dirs:** Walk up from project dir looking for `.claude/skills/`, `.agents/skills/`
3. **OpenCode config dirs:** `{config}/skills/**/SKILL.md` or `{config}/skill/**/SKILL.md`
4. **Additional paths:** From `opencode.jsonc` `skills.paths` array
5. **URL downloads:** From `opencode.jsonc` `skills.urls` array

### Skill Loading Flow

1. On startup, all `SKILL.md` files are scanned and their **name + description** are extracted (~100 tokens each)
2. These descriptions are included in the `skill` tool's description (available_skills list)
3. The agent reads descriptions and decides when to load a skill
4. When loaded via `skill({ name: "..." })`, the full SKILL.md body is injected into context
5. Bundled files (scripts/, references/) are listed but not loaded — the agent reads them as needed

### How the skill tool works

The `skill` tool (defined in `src/tool/skill.ts`):
1. Lists all accessible skills in its description (filtered by agent permissions)
2. When called with a skill name, reads the full SKILL.md content
3. Returns `<skill_content name="...">` block with the content + skill base directory
4. Also lists up to 10 files in the skill directory for the agent to reference

---

## Tools

### What is a Tool?

A tool is a **capability** the agent can invoke — bash commands, file operations, web search, etc. Tools are defined in TypeScript and registered with the framework.

### Built-in Tools

These are part of OpenCode core:

| Tool | Description |
|---|---|
| `bash` | Execute shell commands |
| `read` | Read files |
| `edit` | Edit files (string replacement) |
| `write` | Write/create files |
| `glob` | File pattern matching |
| `grep` | Content search |
| `task` | Spawn subagent sessions |
| `skill` | Load skills |
| `todowrite` | Manage task list |
| `todoread` | Read task list |
| `question` | Ask user questions |

### Custom Tools

Custom tools are TypeScript files in `tools/*.ts` in the config directory. They use the `Tool.define()` API:

```typescript
import { Tool } from "opencode/tool"
import z from "zod"

export default Tool.define("my-tool", async (ctx) => {
  return {
    description: "What this tool does",
    parameters: z.object({
      input: z.string().describe("Input parameter"),
    }),
    async execute(params, ctx) {
      // Do work
      return {
        title: "Short result title",
        output: "Full output text",
        metadata: { key: "value" },
      }
    },
  }
})
```

### Tool Permissions

Tools respect the agent's permission rules. Each tool call checks:
1. Agent-level permissions (from agent frontmatter)
2. Session-level permissions (from parent session overrides)
3. Global permission setting (from `opencode.jsonc` `"permission"`)

With `"permission": "allow"` in config, all tools are auto-approved.

### MCP Tools

OpenCode supports Model Context Protocol (MCP) servers that provide additional tools:

```json
{
  "mcp": {
    "context7": {
      "type": "remote",
      "url": "https://mcp.context7.com/mcp",
      "headers": { "CONTEXT7_API_KEY": "{env:CONTEXT7_API_KEY}" },
      "enabled": true
    }
  }
}
```

MCP tools appear alongside built-in and custom tools. The agent uses them the same way.

---

## Commands

### What is a Command?

A command is a **slash-triggered workflow** — a prompt template that routes to a specific agent with predefined instructions. Defined as `.md` files with YAML frontmatter.

### Command Definition

Location: `commands/*.md` in the config directory.

```markdown
---
description: "What this command does"
agent: kortix
---

# Command Prompt Template

This content becomes the prompt sent to the specified agent.
The user's input after the slash command is appended.

$ARGUMENTS - placeholder for user's input after the command name
```

### Frontmatter Fields

| Field | Type | Description |
|---|---|---|
| `description` | string | Shown in UI command palette |
| `agent` | string | Which agent handles this command |
| `model` | string | Override model for this command |

### Command Routing

When user types `/research quantum computing`:
1. OpenCode looks up `commands/research.md`
2. Reads the frontmatter to get the target agent
3. Sends the command's prompt template (with `$ARGUMENTS` replaced) to that agent
4. The agent executes with its full tool/skill access

---

## Sessions

### Session Lifecycle

```
CREATE → PROMPT → BUSY (tool calls, text generation) → IDLE → PROMPT again...
                                                      → ABORT
                                                      → DELETE
```

### Session Data Model

```json
{
  "id": "ses_...",
  "title": "Session Title",
  "projectID": "global",
  "directory": "/workspace",
  "parentID": "ses_...",           // Only for subagent sessions
  "permission": [...],             // Permission overrides
  "time": { "created": 123, "updated": 456 }
}
```

### Subagent Sessions

When the Task tool spawns a subagent:
1. Creates a child session with `parentID` pointing to parent
2. Applies permission restrictions (todowrite/todoread denied, optionally task denied)
3. Sends the prompt to the child session
4. Waits for completion, returns the last text part

### Storage Layout

All session data stored as JSON files:
```
.local/share/opencode/storage/
├── session/global/ses_*.json     # Session metadata
├── message/ses_*/msg_*.json      # Messages per session  
├── part/msg_*/prt_*.json         # Content parts per message
├── todo/ses_*.json               # Todo lists per session
└── tool-output/tool_*            # Large tool outputs
```

### REST API

Base URL: `http://localhost:3111`

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/session` | List all sessions |
| `POST` | `/session` | Create session |
| `GET` | `/session/{id}` | Get session |
| `DELETE` | `/session/{id}` | Delete session |
| `GET` | `/session/{id}/message` | All messages with parts |
| `POST` | `/session/{id}/message` | Send message (synchronous) |
| `POST` | `/session/{id}/prompt_async` | Send prompt (fire-and-forget) |
| `GET` | `/session/{id}/children` | List subagent sessions |
| `POST` | `/session/{id}/abort` | Abort running session |
| `GET` | `/session/status` | Map of busy sessions |
| `GET` | `/config` | Full config |
| `GET` | `/agent` | All agents |
| `GET` | `/provider` | Providers and models |
| `GET` | `/skill` | All skills with content |
| `GET` | `/event` | SSE event stream |

### SSE Events

`GET /event` returns a Server-Sent Events stream:

```
data: {"type":"session.status","properties":{"sessionID":"ses_...","status":{"type":"busy"}}}
data: {"type":"message.part.updated","properties":{"part":{"type":"text",...},"delta":"word "}}
data: {"type":"session.idle","properties":{"sessionID":"ses_..."}}
```

Event types: `server.connected`, `session.status`, `session.idle`, `session.updated`, `message.updated`, `message.part.updated`, `session.diff`, `file.edited`, `command.executed`

---

## Configuration

### opencode.jsonc

Main config file. In the Kortix sandbox: `/opt/opencode/opencode.jsonc`

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "permission": "allow",                    // Auto-approve all tool calls
  "default_agent": "kortix",               // Default agent for new sessions
  "autoupdate": true,                       // Auto-update OpenCode
  "plugin": [                               // Plugins to load
    "opencode-pty",                         // PTY terminal support
    "./plugin/worktree.ts",                 // Git worktree management
    "./plugin/memory.ts"                    // Memory observation system
  ],
  "agent": {                                // Agent overrides
    "build": { "disable": true },           // Disable built-in agents
    "plan": { "disable": true },
    "explore": { "disable": true },
    "general": { "disable": true }
  },
  "provider": {                             // LLM providers
    "kortix": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "{env:KORTIX_API_URL}/v1/router", "apiKey": "{env:KORTIX_TOKEN}" },
      "models": {
        "kortix/basic": { "name": "Kortix Basic", "cost": { "input": 3, "output": 15 } },
        "kortix/power": { "name": "Kortix Power", "cost": { "input": 5, "output": 25 } }
      }
    }
  },
  "mcp": {                                  // MCP server connections
    "context7": { "type": "remote", "url": "https://mcp.context7.com/mcp" }
  }
}
```

### Config Discovery

OpenCode searches for config in these directories (merged in order):
1. `.opencode/` in the current directory and parent directories
2. `$OPENCODE_CONFIG_DIR` (e.g., `/opt/opencode/`)
3. Global: `~/.config/opencode/`

### Environment Variable Interpolation

Config values support `{env:VAR_NAME}` syntax for environment variable interpolation:
```json
{ "baseURL": "{env:KORTIX_API_URL}/v1/router" }
```

### Plugins

Plugins extend OpenCode with custom tools, hooks, and functionality:
- **npm plugins:** Referenced by package name (e.g., `"opencode-pty"`)
- **local plugins:** Referenced by path (e.g., `"./plugin/memory.ts"`)

Plugins can register tools, listen to events, modify behavior.

---

## Provider System

### How Providers Work

Providers connect OpenCode to LLM APIs. They use the Vercel AI SDK provider pattern:

```json
{
  "provider": {
    "provider-name": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Display Name",
      "options": { "baseURL": "...", "apiKey": "..." },
      "models": {
        "provider/model-id": {
          "name": "Model Name",
          "cost": { "input": 3, "output": 15 },
          "limit": { "context": 200000, "output": 8192 }
        }
      }
    }
  }
}
```

### Model References

Models are referenced as `provider/model-id` throughout the system:
- In agent frontmatter: `model: anthropic/claude-opus-4-6`
- In API calls: `{ "providerID": "kortix", "modelID": "kortix/basic" }`
- In config: `"model": "anthropic/claude-sonnet-4-20250514"`

---

## Key Files

| Path | Description |
|---|---|
| `opencode.jsonc` | Main configuration |
| `agents/*.md` | Agent definitions |
| `skills/*/SKILL.md` | Skill definitions |
| `tools/*.ts` | Custom tool implementations |
| `commands/*.md` | Slash command definitions |
| `plugin/*.ts` | Local plugins |

