---
name: fullstack-vite-convex
description: "Full-stack web development with Convex + Vite React. TDD-driven, strict TypeScript, fully autonomous. Covers scaffolding, schema design, backend functions, frontend components, testing, styling, and deployment. Use when building web apps, sites, or frontend tasks from scratch or adding features to Convex projects. Triggers on: 'build a web app', 'create a site', 'Convex app', 'React app', 'full-stack', 'frontend', 'build me an app', any request to create or modify a Convex + Vite React application."
---

# Full-Stack Web Development — Convex + Vite React

Build production-quality Convex + Vite React applications with **test-driven development** and **strict TypeScript**. Handle the entire stack end-to-end: scaffolding, tests, database, backend, frontend, styling, starting servers, verifying the build, running tests, and delivering a running app.

## Core Principles

### 1. Autonomy Is Non-Negotiable

- **NEVER** tell the user to run commands. YOU run them.
- **NEVER** say "you can now run..." or "please execute...". Just do it.
- Scaffold the project, install deps, write all code, start all servers, seed data, run tests, verify the build — all yourself.
- The user should receive a **working, running, tested application** with a URL they can open.
- If something fails, fix it yourself. Don't report errors without attempting resolution.

### 2. TDD By Default

- **Write tests BEFORE implementation.** Always.
- Backend: write Convex function tests before writing the functions.
- Frontend: write component tests before writing the components.
- Every feature gets a test. No exceptions.
- Tests must pass before moving to the next phase. Run them yourself and fix failures.

### 3. Strict TypeScript — Zero Tolerance

- All code uses strict TypeScript. No `any`. No `as unknown as X` hacks. No `@ts-ignore`.
- Enable all strict flags in `tsconfig.json` — `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitReturns: true`, `noFallthroughCasesInSwitch: true`, `exactOptionalPropertyTypes: true`.
- Every function has explicit return types. Every variable has a type or is inferable.
- Use `Id<"tableName">` for Convex IDs, never `string`.
- Use discriminated unions with `as const` for status/kind fields.
- `npx tsc --noEmit` must produce **0 errors** before you deliver. Run it and fix every error.

## Documentation Lookup

Always use Context7 MCP tools (`resolve-library-id` then `query-docs`) when you need library, API, or framework documentation. Do NOT ask the user. Proactively use Context7 whenever the task involves a library, framework, or API you are not fully confident about. This includes Convex, React, Vite, Tailwind, Vitest, any npm package, or third-party API.

---

## Workflow

### Phase 1: Scaffold & Setup (Local by Default)

Scaffold the project yourself — no Convex account or cloud needed:

```bash
npm create convex@latest -- -t react-vite my-app && cd my-app && npm install
```

Install ALL deps in one shot — testing, styling, utilities:

```bash
npm install lucide-react && npm install -D tailwindcss @tailwindcss/vite vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom @types/node
```

Project structure:
```
my-app/
  convex/                # Backend
    _generated/          # Auto-generated (never edit)
    schema.ts
    tsconfig.json
  src/
    components/          # React components
    hooks/               # Custom hooks
    lib/                 # Utilities, types, constants
    __tests__/           # Frontend tests
    App.tsx
    main.tsx
  tests/                 # Backend/integration tests
  package.json
  tsconfig.json
  vite.config.ts
  vitest.config.ts
```

### Phase 2: Configure Strict TypeScript

Set up `tsconfig.json` with maximum strictness:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["DOM", "DOM.Iterable", "ESNext"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src/**/*", "tests/**/*", "vite.config.ts", "vitest.config.ts"],
  "exclude": ["convex"]
}
```

Set up `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
    },
  },
});
```

Create `src/test-setup.ts`:

```typescript
import "@testing-library/jest-dom/vitest";
```

Add test scripts to `package.json`:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "tsc --noEmit && vitest run"
  }
}
```

### Phase 3: Schema & Types

Define schema in `convex/schema.ts` and export shared types in `src/lib/types.ts`.

Define all data types, constants, and enums upfront. Use discriminated unions for status fields:

```typescript
// src/lib/types.ts
export const BOOKING_STATUS = {
  pending: "pending",
  confirmed: "confirmed",
  cancelled: "cancelled",
} as const;

export type BookingStatus = (typeof BOOKING_STATUS)[keyof typeof BOOKING_STATUS];
```

### Phase 4: Write Tests First (TDD)

**Backend tests** — test Convex function logic (validators, edge cases):

```typescript
// tests/services.test.ts
import { describe, it, expect } from "vitest";

describe("services", () => {
  it("should validate service has required fields", () => {
    const service = {
      name: "Consultation",
      description: "1-on-1 session",
      duration: 60,
      price: 150,
      category: "consulting",
      available: true,
      icon: "phone",
    };
    expect(service.name).toBeDefined();
    expect(service.price).toBeGreaterThan(0);
    expect(service.duration).toBeGreaterThan(0);
  });

  it("should reject invalid price", () => {
    expect(() => {
      if (-1 <= 0) throw new Error("Price must be positive");
    }).toThrow("Price must be positive");
  });
});
```

**Frontend component tests** — test rendering, user interactions:

```typescript
// src/__tests__/ServiceCard.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ServiceCard } from "../components/ServiceCard";

describe("ServiceCard", () => {
  const mockService = {
    _id: "test-id" as any,
    _creationTime: Date.now(),
    name: "Consultation",
    description: "1-on-1 session",
    duration: 60,
    price: 150,
    category: "consulting",
    available: true,
    icon: "phone",
  };

  it("renders service name and price", () => {
    render(<ServiceCard service={mockService} onBook={() => {}} />);
    expect(screen.getByText("Consultation")).toBeInTheDocument();
    expect(screen.getByText(/\$150/)).toBeInTheDocument();
  });

  it("shows unavailable state when not available", () => {
    render(<ServiceCard service={{ ...mockService, available: false }} onBook={() => {}} />);
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
  });
});
```

**Run tests — they should fail (red phase):**

```bash
npx vitest run
```

### Phase 5: Implement Code (Green Phase)

Now write the implementation to make tests pass:

1. **Backend functions** — queries, mutations, actions, seed data in `convex/`
2. **Frontend components** — each in its own file with typed props interfaces
3. **Hooks** — custom hooks for shared logic
4. **Pages** — route-level components composing smaller pieces

**Run tests again — they must pass (green phase):**

```bash
npx vitest run
```

Fix any failures before proceeding.

### Phase 6: Refactor

With passing tests as a safety net, refactor:
- Extract shared logic into hooks/utilities
- Remove duplication
- Improve component composition
- Tighten types

**Run tests after every refactor to ensure nothing broke.**

### Phase 7: Start Servers & Verify

Start the **local** Convex backend:

```bash
npx convex dev --local &
```

Start the Vite dev server:

```bash
npm run dev &
```

Seed data if needed:

```bash
npx convex run --local myFile:seedFunction
```

### Phase 8: Final Verification

Run the full verification pipeline — ALL must pass:

```bash
npx tsc --noEmit && npx vitest run && npm run build
```

This checks:
1. **TypeScript** — 0 type errors (strict mode)
2. **Tests** — all tests pass
3. **Build** — Vite compiles cleanly

Fix any failures yourself. Do not deliver until all 3 pass with 0 errors.

### Phase 9: Deliver

Report to the user:
- The running app URL (e.g. `http://localhost:5173`)
- What was built — features, pages, backend functions
- Test results — X tests passing, 0 failures
- Build status — 0 TypeScript errors, 0 build errors
- Mention: *"Running locally with a local Convex backend. When you want to deploy to the cloud, run `npx convex login` then `npx convex deploy`."*

---

## Schema Design

Always define the schema first in `convex/schema.ts`:

```typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
  }).index("by_email", ["email"]),

  messages: defineTable({
    authorId: v.id("users"),
    content: v.string(),
    channelId: v.id("channels"),
  }).index("by_channel", ["channelId"]),
});
```

Rules:
- Always include all index fields in the index name (e.g. `by_field1_and_field2`)
- System fields `_id` and `_creationTime` are auto-added — never define them
- Field names must not start with `$` or `_`

## Backend Functions

Write functions in `convex/` using the NEW function syntax. Every function MUST have `args` and `returns` validators.

**Public functions** (exposed to clients):
```typescript
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { channelId: v.id("channels") },
  returns: v.array(v.object({
    _id: v.id("messages"),
    _creationTime: v.number(),
    content: v.string(),
    authorId: v.id("users"),
  })),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .order("desc")
      .take(50);
  },
});

export const send = mutation({
  args: { channelId: v.id("channels"), authorId: v.id("users"), content: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", args);
    return null;
  },
});
```

**Internal functions** (only callable from other Convex functions):
```typescript
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
```

**Actions** (for external API calls, use `"use node";` for Node.js modules):
```typescript
"use node";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

export const callExternalAPI = internalAction({
  args: { prompt: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const response = await fetch("https://api.example.com/...");
    const data = await response.json();
    await ctx.runMutation(internal.myFile.saveResult, { data });
    return null;
  },
});
```

## Frontend

Use `convex/react` hooks for real-time data. Always type props with interfaces:

```typescript
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

interface ChatProps {
  readonly channelId: Id<"channels">;
  readonly authorId: Id<"users">;
}

function Chat({ channelId, authorId }: ChatProps): React.ReactElement {
  const messages = useQuery(api.messages.list, { channelId });
  const sendMessage = useMutation(api.messages.send);

  const handleSend = async (content: string): Promise<void> => {
    await sendMessage({ channelId, authorId, content });
  };

  if (messages === undefined) {
    return <ChatSkeleton />;
  }

  return (
    <div>
      {messages.map((msg) => (
        <div key={msg._id}>{msg.content}</div>
      ))}
    </div>
  );
}
```

The `main.tsx` must wrap the app with `ConvexProvider`:

```typescript
import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import App from "./App";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ConvexProvider client={convex}>
      <App />
    </ConvexProvider>
  </React.StrictMode>,
);
```

## Styling

- Use Tailwind CSS (install if not present: `npm install -D tailwindcss @tailwindcss/vite`)
- Responsive design — mobile hamburger menu, responsive grids, touch-friendly targets
- Clean component structure — one component per file, typed props interface
- Use `lucide-react` for icons
- Skeleton loading states for async data
- Toast notifications for user actions (success/error/info)

---

## Convex Rules (Critical)

### Functions
- ALWAYS use the new function syntax with `args` and `returns` validators
- If a function returns nothing, use `returns: v.null()` and `return null`
- `v.bigint()` is DEPRECATED — use `v.int64()` instead
- Use `v.record(keys, values)` for dynamic key objects — `v.map()` and `v.set()` are NOT supported
- Use `api.file.functionName` for public function references, `internal.file.functionName` for internal
- You CANNOT register a function through the `api` or `internal` objects

### Queries
- Do NOT use `.filter()` — define an index and use `.withIndex()` instead
- Convex queries do NOT support `.delete()` — collect results and call `ctx.db.delete(row._id)` on each
- Use `.unique()` for single document queries
- Default order is ascending `_creationTime`. Use `.order("desc")` for reverse.

### Mutations
- `ctx.db.patch(id, fields)` — shallow merge update
- `ctx.db.replace(id, fullDocument)` — full replace
- Both throw if document doesn't exist

### Actions
- Add `"use node";` at top of files using Node.js built-ins
- Actions do NOT have `ctx.db` — they cannot access the database directly
- Use `ctx.runQuery` / `ctx.runMutation` to interact with DB from actions
- Minimize action-to-query/mutation calls (each is a separate transaction = race condition risk)

### Scheduling
- Use `ctx.scheduler.runAfter(delayMs, functionRef, args)` for delayed execution
- Use `ctx.scheduler.runAt(timestamp, functionRef, args)` for specific time execution
- Crons: use `crons.interval()` or `crons.cron()` only — NOT `crons.hourly/daily/weekly`

### File Storage
- `ctx.storage.getUrl(storageId)` returns a signed URL (or null)
- Query `_storage` system table for metadata: `ctx.db.system.get(storageId)`

### HTTP Endpoints
```typescript
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";

const http = httpRouter();
http.route({
  path: "/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.json();
    return new Response(null, { status: 200 });
  }),
});
export default http;
```

### TypeScript
- Use `Id<"tableName">` from `./_generated/dataModel` for typed IDs — NEVER `string`
- Use `Doc<"tableName">` from `./_generated/dataModel` for full document types
- Use `as const` for string literals in discriminated unions
- Add `@types/node` to package.json when using Node.js modules
- All functions have explicit return types
- All component props use `readonly` interface fields
- Never use `any` — use `unknown` and narrow with type guards

---

## Deployment (Cloud — Only When User Asks)

Local dev is the default. Only handle cloud deployment when the user explicitly asks.

1. **Login** — `npx convex login` (the ONE step requiring user interaction — opens browser). Tell the user.
2. **Link** — `npx convex dev` (without `--local`)
3. **Deploy** — `npx convex deploy`

The `.env.local` updates automatically. No code changes needed.

## General Rules

- Match existing project conventions if working in an existing codebase
- Verify the dev server runs and check for errors — fix them yourself
- Install dependencies via npm as needed
- The verification pipeline `npx tsc --noEmit && npx vitest run && npm run build` must produce 0 errors before delivering
- Default to local Convex — never prompt for cloud login unless the user asks to deploy
- **You deliver running, tested apps — not instructions.**
