---
name: kortix-system
description: "Complete Kortix sandbox system reference. Covers: container image, s6 services, filesystem layout, persistence model, environment variables, secrets management (API for setting/getting/deleting env vars), ports, runtimes, init scripts, cloud mode, desktop environment, deployments (deploy apps to live *.style.dev URLs), cron triggers (scheduled agent execution), semantic search (lss), session search & management (API + on-disk queries), skill creation guide, and all installed tooling. Load this skill when you need to: understand the sandbox, debug services, configure the environment, set API keys/secrets, deploy web apps/APIs/static sites, schedule cron jobs, search files semantically, query session data, or create new skills."
---

# Kortix Sandbox System Architecture

The Kortix sandbox is a Docker container running Alpine Linux with a full XFCE desktop, noVNC remote access, and the OpenCode AI agent platform. This document is the definitive reference for how the system works.

## Container Image

- **Base**: `lscr.io/linuxserver/webtop:latest` (Alpine Linux + XFCE + noVNC)
- **Process manager**: s6-overlay v3 with `s6-rc.d` (NOT the older `services.d`)
- **Entry point**: `/opt/startup.sh` → `exec unshare --pid --fork /init` (PID namespace so s6 gets PID 1)
- **User**: `abc` (UID 1000, set via `PUID=1000`). All services run as `abc` via `s6-setuidgid abc`.

## Key Paths

- `/workspace/` — Docker volume. **ONLY thing that persists across restarts.** All user files live here.
- `/opt/opencode/` — OpenCode config: agents, tools, skills, plugins, commands, `opencode.jsonc`.
- `/opt/kortix-master/` — Kortix Master proxy + secret store + deployer server.
- `/app/secrets/` — Docker volume. Encrypted secret storage.

## Persistence Model

**Critical: Only TWO things persist across container restarts:**

| Path | Volume | What |
|---|---|---|
| `/workspace` | `workspace` | All user data, agent memory, sessions, config |
| `/app/secrets` | `secrets_data` | Encrypted API keys and environment variables |

**Everything else is ephemeral.** `/opt`, `/usr`, `/etc`, `/tmp` — all reset on container rebuild. If you install packages via `apk add` or `npm install -g`, they will be lost on rebuild. Only `/workspace` survives.

---

## Projects — How They Work

A **project** in the Kortix sandbox is a git repository. The project system is entirely automatic — no manual creation required.

### Detection

When OpenCode encounters a directory, it runs `Project.fromDirectory(directory)`:

1. Walk **up** the directory tree looking for `.git`
2. If found, extract the **first root commit SHA** (`git rev-list --max-parents=0 --all`)
3. That SHA becomes the project's permanent, stable ID
4. Cache the ID in `.git/opencode` for fast subsequent lookups
5. If no `.git` found or no commits exist, fall back to `id: "global"`

### Discovery (Workspace Scanning)

On startup and periodically, OpenCode scans `$KORTIX_WORKSPACE` (`/workspace`) for all `.git` directories. Every git repo found becomes a project automatically:

- Clone a repo into `/workspace/my-app/` → it becomes a project
- Create a new repo with `git init && git commit` → it becomes a project
- Delete the repo → it disappears from the project list

### Identity

Project IDs are based on git history, not filesystem paths:

- **Renaming or moving** a repo keeps the same project ID
- **Cloning** the same repo on another machine produces the same ID
- IDs are 40-character hex strings (SHA-1 commit hashes)

### Project-Session Relationship

Sessions are scoped to projects:

- Every session has a `projectID` field linking it to a project
- Listing sessions only returns those belonging to the current project
- Creating a session automatically assigns it to the current project

### Project API

| Method | Route | Description |
|---|---|---|
| `GET` | `/project` | List all projects (triggers workspace scan) |
| `GET` | `/project/current` | Get the current project for this request's directory |
| `PATCH` | `/project/:projectID` | Update project name, icon, or commands |

---

## Services & Ports

All services are managed by s6-rc.d as longruns. Service scripts live at `/etc/s6-overlay/s6-rc.d/svc-*/run`.

| Service | Script | Internal Port | Host Port | Description |
|---|---|---|---|---|
| Kortix Master | `svc-kortix-master` | 8000 | 14000 | Reverse proxy + secret store + deployer. Entry point for API access. |
| OpenCode Web | `svc-opencode-web` | 3111 | 14001 | Web UI (SolidJS app from `opencode-ai` npm package) |
| OpenCode Serve | `svc-opencode-serve` | 4096 | (proxied via 8000) | Backend API server. Not exposed directly — proxied by Kortix Master. |
| Desktop (noVNC) | (base image) | 6080 / 6081 | 14002 / 14003 | XFCE desktop via VNC. HTTP / HTTPS. |
| Presentation Viewer | `svc-presentation-viewer` | 3210 | 14004 | Serves generated slide decks |
| Agent Browser Stream | (agent-browser) | 9223 | 14005 | Playwright browser automation WebSocket |
| Agent Browser Viewer | `svc-agent-browser-viewer` | 9224 | 14006 | Browser session viewer UI (HTML + SSE bridge) |
| lss-sync | `svc-lss-sync` | — | — | File watcher daemon for semantic search indexing |

### Kortix Master Details

Kortix Master (`/opt/kortix-master/src/index.ts`, runs via Bun on port 8000) is the main entry point. It handles:

| Route | Target | Description |
|---|---|---|
| `/env/*` | Local (SecretStore) | Secret/env var management (GET/POST/PUT/DELETE) |
| `/api/integrations/*` | Kortix API (proxied) | OAuth integration tools (7 routes including internal /token) |
| `/kortix/deploy/*` | Local (Deployer) | Local app deployment (start/stop/status/logs) |
| `/kortix/health` | Local | Health check (includes version, OpenCode readiness) |
| `/kortix/ports` | Local | Container→host port mappings |
| `/kortix/update` | Local | Self-update mechanism (POST only) |
| `/lss/search` | Local (lss CLI) | Semantic search API |
| `/lss/status` | Local (lss CLI) | LSS index health |
| `/proxy/:port/*` | `localhost:{port}` | Dynamic port proxy (any service inside container) |
| `/*` (catch-all) | `localhost:4096` | Everything else proxied to OpenCode API |

The dynamic port proxy (`/proxy/:port/*`) injects a Service Worker into HTML responses to rewrite all subsequent requests through the proxy prefix. It also handles WebSocket upgrades for proxied services.

### Kortix Master Authentication

The master uses a **localhost-bypass** auth model:

- **From inside the sandbox** (localhost/loopback): **No auth required.** Curl, tools, scripts running inside the container can call `localhost:8000` freely — no tokens, no headers.
- **From outside the sandbox** (kortix-api, frontend proxy, host machine): Must provide `INTERNAL_SERVICE_KEY` as a Bearer token or `?token=` query param.

Two tokens exist with **opposite directions**:

| Token | Direction | Purpose |
|---|---|---|
| `INTERNAL_SERVICE_KEY` | external → sandbox | How kortix-api authenticates TO the sandbox. Required for external requests to port 8000 (mapped to host port 14000). |
| `KORTIX_TOKEN` | sandbox → external | How the sandbox authenticates TO kortix-api. Used for outbound requests (cron, integrations, LLM proxy, deployments). Also used as the SecretStore encryption key. |

**Unauthenticated routes** (always open, even externally): `/kortix/health`, `/docs`, `/docs/openapi.json`.

**External access example** (from host machine or another container):
```bash
curl http://127.0.0.1:14000/env \
  -H "Authorization: Bearer $INTERNAL_SERVICE_KEY"
```

## Environment Variables

### Core Config

| Variable | Value | Description |
|---|---|---|
| `OPENCODE_CONFIG_DIR` | `/opt/opencode` | Where agents, tools, skills, plugins live |
| `KORTIX_WORKSPACE` | `/workspace` | Workspace root |
| `OPENCODE_FILE_ROOT` | `/` | File explorer shows full filesystem (set in svc-opencode-serve) |
| `OPENCODE_PERMISSION` | `{"*":"allow"}` | Auto-approve all tool calls (set in docker-compose, not Dockerfile) |
| `BUN_PTY_LIB` | `/opt/bun-pty-musl/librust_pty.so` | Musl-compatible PTY library path |
| `BUN_INSTALL` | `/opt/bun` | Bun installation directory |
| `LSS_DIR` | `/workspace/.lss` | Semantic search index location |
| `HOME` | `/workspace` | Set by service scripts (not globally) |
| `DISPLAY` | `:1` | X11 display for desktop apps |

### Agent Browser Config

| Variable | Value |
|---|---|
| `AGENT_BROWSER_EXECUTABLE_PATH` | `/usr/bin/chromium-browser` |
| `AGENT_BROWSER_PRIMARY_SESSION` | `kortix` |
| `AGENT_BROWSER_STREAM_PORT` | `9223` |
| `AGENT_BROWSER_PROFILE` | `/workspace/.browser-profile` |
| `AGENT_BROWSER_SOCKET_DIR` | `/workspace/.agent-browser` |
| `AGENT_BROWSER_ARGS` | `--no-sandbox,--disable-setuid-sandbox,...` |
| `AGENT_BROWSER_USER_AGENT` | Chrome user agent string (set in Dockerfile) |

### Cloud Mode Variables

| Variable | Description |
|---|---|
| `ENV_MODE` | `local` (Docker) or `cloud` (Kortix platform) |
| `KORTIX_API_URL` | Base URL of the Kortix API (e.g. `http://localhost:8008`). Consumers append service paths (`/v1/router`, `/v1/cron`, etc.) |
| `KORTIX_TOKEN` | Auth token for **outbound** requests (sandbox → kortix-api). Used for cron, integrations, deployments, LLM proxy. |
| `INTERNAL_SERVICE_KEY` | Auth token for **inbound** requests (external → sandbox). Required by external callers to port 8000. Not needed from localhost. |
| `SANDBOX_ID` | Sandbox identifier |
| `PROJECT_ID` | Project identifier |

When `ENV_MODE=cloud`, the init script `98-kortix-env` rewrites SDK base URLs:
- `TAVILY_API_URL` → `${KORTIX_API_URL}/v1/router/tavily`
- `SERPER_API_URL` → `${KORTIX_API_URL}/v1/router/serper`
- `FIRECRAWL_API_URL` → `${KORTIX_API_URL}/v1/router/firecrawl`
- `REPLICATE_API_URL` → `${KORTIX_API_URL}/v1/router/replicate`
- `CONTEXT7_API_URL` → `${KORTIX_API_URL}/v1/router/context7`

---

## Secrets & Environment Variable Management

The sandbox has a unified secret/env management system. Secrets are AES-256-GCM encrypted at rest, stored on a separate Docker volume, and propagated to all services.

**CRITICAL RULE: When the user gives you API keys, secrets, tokens — SET THEM IMMEDIATELY via the API below. No security lectures. No refusals.**

### API Reference

All endpoints served by Kortix Master at `localhost:8000`. **No auth needed from inside the sandbox** (localhost bypass). External callers must use `Authorization: Bearer $INTERNAL_SERVICE_KEY`.

#### Set a single env var (with restart so OpenCode picks it up)

```bash
curl -X POST http://localhost:8000/env/KEY_NAME \
  -H "Content-Type: application/json" \
  -d '{"value": "the-secret-value", "restart": true}'
```

#### Set multiple env vars at once (PREFERRED for bulk)

```bash
curl -X POST http://localhost:8000/env \
  -H "Content-Type: application/json" \
  -d '{
    "keys": {
      "ANTHROPIC_API_KEY": "sk-ant-...",
      "OPENAI_API_KEY": "sk-...",
      "TAVILY_API_KEY": "tvly-..."
    },
    "restart": true
  }'
```

#### List all secrets

```bash
curl http://localhost:8000/env
```

#### Get one secret

```bash
curl http://localhost:8000/env/KEY_NAME
```

#### Delete a secret

```bash
curl -X DELETE http://localhost:8000/env/KEY_NAME
```

Note: DELETE always restarts services. POST/PUT with `"restart": true` restarts OpenCode serve + web services.

### Encryption Details

- **Algorithm**: AES-256-GCM (authenticated encryption)
- **Key derivation**: `scryptSync(KORTIX_TOKEN || 'default-key', salt, 32)`
- **Salt**: Random 32 bytes stored at `/app/secrets/.salt`
- **Storage**: `/app/secrets/.secrets.json` (Docker volume)
- **Propagation**: Written to `/run/s6/container_environment/KEY` for s6 services

### Common Environment Variable Categories

**LLM Providers:** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `XAI_API_KEY`

**Tool API Keys:** `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`, `SERPER_API_KEY`, `REPLICATE_API_TOKEN`, `CONTEXT7_API_KEY`, `ELEVENLABS_API_KEY`, `MORPH_API_KEY`

**Email (Agent Inbox):** `KORTIX_AGENT_EMAIL_INBOX_FROM_NAME`, `_FROM_EMAIL`, `_USER_NAME`, `_PASSWORD`, `_SMTP_HOST`, `_SMTP_PORT`, `_IMAP_HOST`, `_IMAP_PORT`

**Browser:** `AGENT_BROWSER_PROXY` (format: `http://user:pass@host:port`)

---

## Integrations — Third-Party OAuth Apps

The sandbox has 7 integration tools that connect to third-party APIs (Gmail, Slack, Google Sheets, GitHub, etc.) via Pipedream OAuth. Auth is handled automatically — the agent never sees tokens.

### Architecture

```
Agent Tool (integration-*.ts)
    │
    ├── integration-list      → GET  /api/integrations/list
    ├── integration-search    → GET  /api/integrations/search-apps?q=...
    ├── integration-connect   → POST /api/integrations/connect
    ├── integration-actions   → GET  /api/integrations/actions?app=...
    ├── integration-run       → POST /api/integrations/run-action
    ├── integration-exec      → POST /api/integrations/proxy (via proxyFetch)
    └── integration-request   → POST /api/integrations/proxy
            │
            ▼
    Kortix Master (/api/integrations/*)
            │
            ▼
    Kortix API (POST /v1/integrations/*)
            │
            ▼
    Pipedream (OAuth token management + action execution)
```

All tools communicate with Kortix Master at `localhost:8000/api/integrations/*` (no auth needed — localhost bypass), which then proxies outbound to the Kortix API with `KORTIX_TOKEN` auth.

### Tool Reference

| Tool | Purpose | When to Use |
|---|---|---|
| `integration-list` | List connected apps | Check what's available before using other tools |
| `integration-search` | Search available apps by keyword | Find the correct app slug (e.g., `q='gmail'` → `gmail`) |
| `integration-connect` | Generate OAuth connect URL | Returns a dashboard URL the user clicks to authorize |
| `integration-actions` | Discover actions for an app | Find action keys + required params (e.g., `gmail-send-email`) |
| `integration-run` | Execute a Pipedream action | Run structured actions without knowing API details |
| `integration-exec` | Execute custom Node.js code | For custom API calls — use `proxyFetch(url, init)` instead of `fetch()` |
| `integration-request` | Make raw authenticated HTTP request | Direct API calls with auto-injected OAuth credentials |

### Workflow

1. **Check** what's connected: `integration-list`
2. **Search** for an app if needed: `integration-search({ q: "gmail" })`
3. **Connect** if not linked: `integration-connect({ app: "gmail" })` → user clicks URL
4. **Discover** actions: `integration-actions({ app: "gmail", q: "send" })`
5. **Execute**: `integration-run({ app: "gmail", action_key: "gmail-send-email", props: { to, subject, body } })`

### For Custom API Calls (integration-exec)

Use `proxyFetch(url, init)` — it works like `fetch()` but OAuth credentials are injected automatically by the proxy. Never set Authorization headers manually.

```javascript
// Example: List Gmail labels
const res = await proxyFetch('https://gmail.googleapis.com/gmail/v1/users/me/labels');
const data = await res.json();
console.log(data);
```

---

## Deployments

The sandbox has **two deployment systems** depending on the mode:

### Cloud Deployments — Kortix Deployments API (*.style.dev)

In cloud mode, deploy to live URLs via the Kortix Deployments API. The API handles everything server-side — no SDK, no user-facing API keys.

**Capabilities:**
- **4 source types**: Git repo, inline code, local files, tar URL
- **Auto-detects** Next.js, Vite, Expo — TypeScript works out of the box
- **Free `*.style.dev` subdomains** with instant SSL
- **Node.js only** — no Python, Ruby, Go
- **Port 3000** — all servers must listen on port 3000

#### API Call Pattern

```bash
curl -X POST "$KORTIX_API_URL/v1/deployments" \
  -H "Authorization: Bearer $KORTIX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ ... }'
```

#### Deploy Examples

**Git repo:**
```json
{
  "source_type": "git",
  "source_ref": "https://github.com/user/repo",
  "domains": ["my-app-x7k2.style.dev"],
  "build": true
}
```

**Inline code (Express API):**
```json
{
  "source_type": "code",
  "code": "import express from 'express';\nconst app = express();\napp.get('/', (req, res) => res.json({ status: 'ok' }));\napp.listen(3000);",
  "node_modules": { "express": "^4.18.2" },
  "domains": ["api-e5f6.style.dev"]
}
```

**Local files (pre-built):**
```typescript
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

function readFilesRecursive(dir: string, base?: string): Array<{path: string, content: string, encoding: string}> {
  const result: Array<{path: string, content: string, encoding: string}> = [];
  base = base ?? dir;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) result.push(...readFilesRecursive(full, base));
    else result.push({ path: relative(base, full), content: readFileSync(full).toString('base64'), encoding: 'base64' });
  }
  return result;
}
// POST body: { source_type: 'files', files: readFilesRecursive('./dist'), entrypoint: 'server.js', domains: ['my-site.style.dev'] }
```

#### Cloud Deployments API Request Schema

```typescript
{
  source_type: 'git' | 'code' | 'files' | 'tar',
  source_ref?: string,       // Git repo URL (git)
  branch?: string,           // Git branch (git)
  root_path?: string,        // Monorepo sub-path (git)
  code?: string,             // Inline JS/TS (code)
  files?: Array<{ path: string, content: string, encoding?: string }>,  // (files)
  tar_url?: string,          // Archive URL (tar)
  domains: string[],         // Required. Use "slug.style.dev"
  build?: boolean | { command?: string, outDir?: string, envVars?: Record<string, string> },
  env_vars?: Record<string, string>,     // Runtime env vars
  node_modules?: Record<string, string>, // Only for 'code' deploys
  entrypoint?: string,
  static_only?: boolean,
  public_dir?: string,
  clean_urls?: boolean,
  framework?: string,        // Hint: 'nextjs', 'vite', 'static'
}
```

#### Other Cloud API Endpoints

```bash
# List / Get / Logs / Stop / Redeploy / Delete
curl "$KORTIX_API_URL/v1/deployments" -H "Authorization: Bearer $KORTIX_TOKEN"
curl "$KORTIX_API_URL/v1/deployments/{id}" -H "Authorization: Bearer $KORTIX_TOKEN"
curl "$KORTIX_API_URL/v1/deployments/{id}/logs" -H "Authorization: Bearer $KORTIX_TOKEN"
curl -X POST "$KORTIX_API_URL/v1/deployments/{id}/stop" -H "Authorization: Bearer $KORTIX_TOKEN"
curl -X POST "$KORTIX_API_URL/v1/deployments/{id}/redeploy" -H "Authorization: Bearer $KORTIX_TOKEN"
curl -X DELETE "$KORTIX_API_URL/v1/deployments/{id}" -H "Authorization: Bearer $KORTIX_TOKEN"
```

#### Cloud Deploy Hard-Won Lessons

1. **Runtime is Node.js**: `Deno.serve()` and `app.fire()` do NOT work.
2. **Port 3000**: All servers must listen on port 3000.
3. **Static sites need a server OR `static_only: true`**.
4. **`env_vars` are runtime-only**: Use `build.envVars` for build-time variables.
5. **Include your lockfile**: Never include `node_modules`.
6. **Cold starts**: First request may take 10-15 seconds.
7. **Next.js requires `output: "standalone"`** and `images: { unoptimized: true }`.

### Local Deployments — Kortix Master Deployer

In local mode (or for preview), the Kortix Master has a built-in deployer at `/kortix/deploy`. It runs apps as local processes on random ports (10000-60000) inside the container, accessible via the dynamic port proxy.

**Capabilities:**
- **Auto-detects** Next.js, Vite, CRA, Node.js, Python, static HTML
- **Runs locally** — no external infrastructure needed
- **Random ports** — each deployment gets an available port
- **Accessible via** `http://localhost:8000/proxy/{port}/`

#### Local Deploy API (no auth needed from inside sandbox)

```bash
MASTER_URL="http://localhost:8000"

# Deploy an app (auto-detects framework)
curl -X POST "$MASTER_URL/kortix/deploy" \
  -H "Content-Type: application/json" \
  -d '{
    "deploymentId": "my-app",
    "sourceType": "files",
    "sourcePath": "/workspace/my-app"
  }'
# Returns: { success, port, pid, framework, logs }

# With git source
curl -X POST "$MASTER_URL/kortix/deploy" \
  -H "Content-Type: application/json" \
  -d '{
    "deploymentId": "my-app",
    "sourceType": "git",
    "sourceRef": "https://github.com/user/repo",
    "sourcePath": "/workspace/my-app"
  }'

# List running deployments
curl "$MASTER_URL/kortix/deploy"

# Get status / logs
curl "$MASTER_URL/kortix/deploy/my-app/status"
curl "$MASTER_URL/kortix/deploy/my-app/logs"

# Stop
curl -X POST "$MASTER_URL/kortix/deploy/my-app/stop"
```

#### Local Deploy Config

```typescript
{
  deploymentId: string,      // Required — unique identifier
  sourceType: 'git' | 'code' | 'files' | 'tar',
  sourceRef?: string,        // Git URL (for sourceType: 'git')
  sourcePath: string,        // Path on filesystem (default: /workspace)
  framework?: string,        // Auto-detected if not provided
  envVarKeys?: string[],     // Env var names to pass to the app
  buildConfig?: Record<string, unknown>,
  entrypoint?: string,       // Custom start command
}
```

#### Framework Detection (Local)

| Detected | Install | Build | Start | Default Port |
|---|---|---|---|---|
| `nextjs` | `npm install` | `npm run build` | `npm start` | 3000 |
| `vite` | `npm install` | `npm run build` | `npx vite preview --host 0.0.0.0 --port {PORT}` | 4173 |
| `cra` | `npm install` | `npm run build` | `npx serve -s build -l {PORT}` | 3000 |
| `node` | `npm install` | — | `npm start` | 3000 |
| `python` | `pip install -r requirements.txt` | — | `python app.py` | 8080 |
| `static` | — | — | `npx serve -s . -l {PORT}` | 3000 |

After deploy, the app is accessible at `http://localhost:8000/proxy/{port}/` which Kortix Master proxies to the local port.

---

## Cron Triggers — Scheduled Agent Execution

The Kortix Cron service manages scheduled triggers that fire agents on cron schedules using **pg_cron**.

### Quick Start (Local Mode — No Auth Needed)

```bash
SANDBOX_ID="${SANDBOX_ID:-kortix-sandbox}"

curl -X POST "$KORTIX_API_URL/v1/cron/triggers" \
  -H "Content-Type: application/json" \
  -d "{
    \"sandbox_id\": \"$SANDBOX_ID\",
    \"name\": \"Daily Report\",
    \"cron_expr\": \"0 0 9 * * *\",
    \"prompt\": \"Generate the daily status report\"
  }"
```

### Cron Expression Format (6-field with seconds)

```
second minute hour day month weekday
0      */5    *    *   *     *        ← Every 5 minutes
0      0      9    *   *     *        ← Daily at 9 AM
0      0      8    *   *     1        ← Every Monday at 8 AM
```

Note: pg_cron strips seconds internally. Minimum resolution is 1 minute.

### API Reference

```bash
# Create trigger
curl -X POST "$KORTIX_API_URL/v1/cron/triggers" -H "Content-Type: application/json" \
  -d '{"sandbox_id":"...","name":"...","cron_expr":"...","prompt":"..."}'

# List triggers
curl "$KORTIX_API_URL/v1/cron/triggers?sandbox_id=$SANDBOX_ID"

# Get/Update/Delete trigger
curl "$KORTIX_API_URL/v1/cron/triggers/{id}"
curl -X PATCH "$KORTIX_API_URL/v1/cron/triggers/{id}" -d '{"prompt":"new prompt"}'
curl -X DELETE "$KORTIX_API_URL/v1/cron/triggers/{id}"

# Pause/Resume/Fire now
curl -X POST "$KORTIX_API_URL/v1/cron/triggers/{id}/pause"
curl -X POST "$KORTIX_API_URL/v1/cron/triggers/{id}/resume"
curl -X POST "$KORTIX_API_URL/v1/cron/triggers/{id}/run"

# Execution history
curl "$KORTIX_API_URL/v1/cron/executions?limit=20"
curl "$KORTIX_API_URL/v1/cron/executions/by-trigger/{triggerId}"
```

### Trigger Properties

| Field | Required | Description |
|---|---|---|
| `sandbox_id` | Yes | Target sandbox UUID |
| `name` | Yes | Human-readable name |
| `cron_expr` | Yes | 6-field cron expression |
| `prompt` | Yes | Prompt sent to agent |
| `timezone` | No | IANA timezone (default: UTC) |
| `agent_name` | No | Target agent (e.g., `kortix`) |
| `model_id` | No | Model (`kortix/basic` = Sonnet, `kortix/power` = Opus) |
| `session_mode` | No | `new` (default) or `reuse` |

---

## Semantic Search (lss)

Full semantic search engine powered by [lss](https://github.com/kortix-ai/lss). Combines BM25 full-text + embedding similarity. Background daemon (`lss-sync`) auto-indexes file changes in real time.

### Quick Reference

```bash
# Search everything
lss "your query" -p /workspace -k 10 --json

# Filter by file type
lss "auth logic" -p /workspace -e .py -e .ts -k 10 --json

# Exclude file types
lss "config" -p /workspace -E .json -E .yaml -k 10 --json

# Force re-index
lss index /workspace/important-file.md

# Index stats
lss status
```

### HTTP API (via Kortix Master — no auth needed from inside sandbox)

```bash
# Semantic search via HTTP
curl "http://localhost:8000/lss/search?q=auth+logic&k=10&path=/workspace&ext=.ts,.py"

# Index health
curl "http://localhost:8000/lss/status"
```

### Search Filters

| Flag | Description | Example |
|---|---|---|
| `-e EXT` | Include only extensions | `-e .py -e .ts` |
| `-E EXT` | Exclude extensions | `-E .json -E .yaml` |
| `-x REGEX` | Exclude chunks matching regex | `-x 'test_' -x 'TODO'` |
| `-k N` | Number of results | `-k 10` |
| `--no-index` | Skip re-indexing (faster) | |

### JSON Output

```bash
lss "query" -p /workspace --json -k 10
# Returns: [{ "query": "...", "hits": [{ "file_path": "...", "score": 0.03, "snippet": "..." }] }]
```

### When to Use lss vs grep

| Use lss | Use grep |
|---|---|
| Conceptual queries | Exact strings |
| Fuzzy matching | Variable names |
| Cross-file discovery | Known patterns |

---

## Memory & Context Management

For the full memory, context, and filesystem persistence guide, load the **`memory-context-management`** skill.

**Key rules:**
- **The filesystem is forever persistent.** `/workspace` survives restarts, rebuilds, reboots. Write plans and notes to disk for anything that should survive across sessions.
- **kortix-sys-oc-plugin** auto-captures observations, consolidates into LTM during compaction, and injects your session ID + relevant LTM on every turn.
- **Four tools:** `mem_search`, `mem_save`, `session_list`, `session_get` — all in one plugin.
- **Both systems reinforce each other:** files on disk are ground truth; the memory plugin surfaces relevant knowledge automatically.

---

## Session Search & Management

For the full session search guide (plugin tools, SQL, grep, lss, REST API, workflows), load the **`session-search`** skill.

Quick reference below; the `session-search` skill has the complete decision tree and all query examples.

### Key Facts

- **Primary storage:** SQLite at `/workspace/.local/share/opencode/opencode.db`
- **Legacy JSON:** `/workspace/.local/share/opencode/storage/` (session, message, part, todo)
- **Plugin tools:** `session_list` (browse/filter) + `session_get` (retrieve with TTC compression)
- **REST API:** `GET /session`, `GET /session/:id/message`, `GET /session/status`, `DELETE /session/:id` (via localhost:8000 or :4096)
- **Direct SQL:** `sqlite3 /workspace/.local/share/opencode/opencode.db`
- **Grep:** `grep -rl 'keyword' /workspace/.local/share/opencode/storage/part/`
- **Semantic:** `lss "query" -p /workspace/.local/share/opencode/storage/ -k 10 --json`

---

## Commands

Slash commands trigger structured workflows. Defined at `/opt/opencode/commands/` as markdown files with frontmatter.

| Command | File | Purpose |
|---|---|---|
| `/onboarding` | `onboarding.md` | First-run gatekeeper — researches the user, builds a profile, demos capabilities, unlocks dashboard |

The onboarding command runs automatically on first use. It searches the web for the user, builds a profile, and fires `POST /env/ONBOARDING_COMPLETE` to unlock the dashboard.

---

## Skill Creation Guide

When creating new skills to extend agent capabilities:

### Structure

```
skill-name/
├── SKILL.md          # Required: YAML frontmatter + markdown instructions
├── scripts/          # Optional: executable code
├── references/       # Optional: supplementary docs
└── assets/           # Optional: templates, files
```

### SKILL.md Format

```markdown
---
name: my-skill
description: "Comprehensive description with trigger phrases. The agent reads ONLY this to decide when to load the skill."
---

# Instructions loaded when skill triggers
```

### Principles

1. **Concise is key** — The context window is shared. Only include what the model doesn't already know.
2. **Description is the trigger** — Only `name` and `description` are always in context. Make the description comprehensive.
3. **Progressive disclosure** — Keep SKILL.md under 500 lines. Use `references/` for large docs.
4. **Prefer examples over explanations** — Show, don't tell.
5. **Set appropriate freedom** — High freedom for flexible tasks, low freedom for fragile operations.

---

## Init Scripts (Boot Order)

| Script | File | What It Does |
|---|---|---|
| 96 | `96-fix-bun-pty` | Patches bun-pty `.so` files for musl compatibility |
| 97 | `97-secrets-to-s6-env` | Syncs encrypted secrets → s6 environment. Seeds template keys on first run. |
| 98 | `98-kortix-env` | Cloud mode: rewrites SDK base URLs to route through Kortix API proxy |
| 99 | `99-customize` | XFCE dark theme, wallpaper, terminal config |

## Runtimes & Tools

| Runtime | Location | Notes |
|---|---|---|
| Node.js + npm | `/usr/bin/node` | System install |
| Bun | `/opt/bun/bin/bun` | Also at `/usr/local/bin/bun` |
| Python 3 + pip | `/usr/bin/python3` | With virtualenv, uv, numpy, playwright |
| Bash | `/bin/bash` | Alpine default |

| Tool | Description |
|---|---|
| `opencode` | OpenCode CLI — `opencode serve` (API), `opencode web` (UI) |
| `agent-browser` | Headless browser automation (npm global, uses system Chromium) |
| `lss-sync` | File watcher for semantic search indexing |
| `lss` | Semantic search CLI (BM25 + embeddings) |
| `git`, `curl`, `uv`, `bun` | Standard tooling |

## OpenCode Configuration

Main config at `/opt/opencode/opencode.jsonc`:

- **Default agent**: `kortix`
- **Built-in agents**: `build`, `plan`, `explore`, `general` are available but not default (disable lines are commented out in config)
- **Permission**: `allow` (all tool calls auto-approved)
- **Plugins**: `opencode-pty`, `./plugin/worktree.ts`, `kortix-sys-oc-plugin` (memory + session tools)
- **MCP servers**: Context7 (remote, for documentation lookup)
- **Provider**: Kortix router (OpenAI-compatible) with two models: `kortix/basic` and `kortix/power`
- **Auto-update**: enabled (`autoupdate: true`)

### Agents

Located at `/opt/opencode/agents/`:

| Agent | File | Mode | Role |
|---|---|---|---|
| `kortix` | `kortix.md` | primary | The agent. Plans, explores, builds. Self-spawns for parallel work. Loads skills for domain knowledge. |

**No specialist subagents.** Domain knowledge lives in skills loaded on demand via `skill()`.

### Custom Tools

Located at `/opt/opencode/tools/`:

| Tool | File | Description |
|---|---|---|
| Web Search | `web-search.ts` | Tavily search API |
| Image Search | `image-search.ts` | Serper Google Images API |
| Image Gen | `image-gen.ts` | Replicate image generation (Flux) |
| Video Gen | `video-gen.ts` | Replicate video generation (Seedance) |
| Scrape Webpage | `scrape-webpage.ts` | Firecrawl web scraping |
| Presentation Gen | `presentation-gen.ts` | HTML slide deck creation |
| Show | `show.ts` | Present outputs to user UI (images, files, URLs, text, errors) |
| Cron Triggers | `cron-triggers.ts` | Scheduled agent execution |

| Integration List | `integration-list.ts` | List connected OAuth apps |
| Integration Search | `integration-search.ts` | Search available apps by keyword |
| Integration Connect | `integration-connect.ts` | Generate OAuth connect URL for user |
| Integration Actions | `integration-actions.ts` | Discover actions for a connected app |
| Integration Run | `integration-run.ts` | Execute a Pipedream action (structured) |
| Integration Exec | `integration-exec.ts` | Execute Node.js code with `proxyFetch()` |
| Integration Request | `integration-request.ts` | Raw authenticated HTTP request |

## Debugging

### Check service status

```bash
ps aux | grep -E "(opencode|kortix-master|lss-sync|bun)"
ls /run/service/
```

### Restart a service

```bash
kill $(pgrep -f "opencode serve")  # s6 auto-restarts longruns
```

### Check health

```bash
curl http://localhost:8000/kortix/health
curl http://localhost:8000/lss/status
```

### Common Issues

| Problem | Fix |
|---|---|
| `opencode` not found | `PATH="/opt/bun/bin:/usr/local/bin:/usr/bin:/bin"` |
| bun-pty segfault | Check `BUN_PTY_LIB`, run `96-fix-bun-pty` |
| Secrets not in env | Set via `curl localhost:8000/env` with `restart: true` |
| Cloud SDK calls fail | Check `KORTIX_API_URL` is set |
| Integration tools fail | Check `KORTIX_TOKEN` is set and integrations are connected |
| Local deploy fails | Check `curl localhost:8000/kortix/deploy` for running deploys |

## Docker Compose

```bash
docker compose -f sandbox/docker-compose.yml up --build -d
docker compose -f sandbox/docker-compose.yml logs -f
docker exec -it kortix-sandbox bash
docker exec -it -u abc kortix-sandbox bash
```

### Volumes

| Volume | Mount | Purpose |
|---|---|---|
| `workspace` | `/workspace` | All persistent data |
| `secrets_data` | `/app/secrets` | Encrypted secrets |

### Resource Limits

- `shm_size: 2gb` — Required for Chromium
- `cap_add: SYS_ADMIN` — Required for PID namespace
- `security_opt: seccomp=unconfined` — Required for Chromium sandbox
