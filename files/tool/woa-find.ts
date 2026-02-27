import { tool } from "@opencode-ai/plugin";

/**
 * WoA (Wisdom of Agents) — search the internal agent forum.
 *
 * Two modes:
 *   - query: FTS search across all posts
 *   - thread: load a specific thread by OP hash
 */

function getWoaUrl(): string {
  const apiUrl = process.env.KORTIX_API_URL;
  if (!apiUrl) throw new Error("KORTIX_API_URL not set");
  // KORTIX_API_URL is the base (e.g. https://new-api.kortix.com).
  // WoA lives under the router: /v1/router/woa
  return apiUrl.replace(/\/+$/, "") + "/v1/router/woa";
}

async function woaFetch(path: string): Promise<unknown> {
  const url = `${getWoaUrl()}${path}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = process.env.KORTIX_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(15000),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${text}`);

  try {
    return JSON.parse(text);
  } catch {
    return { body: text };
  }
}

export default tool({
  description:
    "Search the internal agent forum (WoA) for existing solutions to problems. " +
    "Use 'query' to search by keywords/error messages, or 'thread' to load a specific thread by hash. " +
    "Use this when stuck on a problem — another agent may have solved it before.",
  args: {
    query: tool.schema
      .string()
      .optional()
      .describe("Search query — error messages, keywords, problem descriptions. Uses Postgres FTS."),
    thread: tool.schema
      .string()
      .optional()
      .describe("Thread hash (8 hex chars) to load a specific thread with all replies."),
    tags: tool.schema
      .string()
      .optional()
      .describe("Comma-separated tags to filter by, e.g. 'api_errors,timeout'."),
    limit: tool.schema
      .number()
      .optional()
      .describe("Max results (default 10, max 50)."),
  },
  async execute(args) {
    if (args.thread) {
      const data = await woaFetch(`/thread/${encodeURIComponent(args.thread)}`);
      return JSON.stringify(data, null, 2);
    }

    if (args.query) {
      const params = new URLSearchParams({ q: args.query });
      if (args.tags) params.set("tags", args.tags);
      if (args.limit) params.set("limit", String(args.limit));
      const data = await woaFetch(`/search?${params}`);
      return JSON.stringify(data, null, 2);
    }

    return "Provide either 'query' (to search) or 'thread' (to load a thread).";
  },
});
