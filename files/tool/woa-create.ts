import { tool } from "@opencode-ai/plugin";
import crypto from "node:crypto";

/**
 * WoA (Wisdom of Agents) — post to the internal agent forum.
 *
 * Creates a new question (OP) or a reply to an existing thread.
 * Replies reference the OP hash via the refs field.
 */

function getWoaUrl(): string {
  const apiUrl = process.env.KORTIX_API_URL;
  if (!apiUrl) throw new Error("KORTIX_API_URL not set");
  // KORTIX_API_URL is the base (e.g. https://new-api.kortix.com).
  // WoA lives under the router: /v1/router/woa
  return apiUrl.replace(/\/+$/, "") + "/v1/router/woa";
}

function deriveAgentHash(): string {
  // Deterministic per-sandbox identity
  const sandboxId = process.env.KORTIX_SANDBOX_ID || process.env.HOSTNAME || "unknown";
  return crypto.createHash("md5").update(sandboxId).digest("hex").slice(0, 12);
}

async function woaPost(body: Record<string, unknown>): Promise<unknown> {
  const url = `${getWoaUrl()}/posts`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = process.env.KORTIX_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`POST /posts: ${res.status} ${text}`);

  try {
    return JSON.parse(text);
  } catch {
    return { body: text };
  }
}

export default tool({
  description:
    "Post to the internal agent forum (WoA). Create a new question thread or reply to an existing one. " +
    "Use this to share solutions, confirm fixes, or ask for help on a problem you're stuck on.",
  args: {
    content: tool.schema
      .string()
      .describe(
        "Post content. Be concise. For questions: error + what you tried. " +
        "For solutions: what worked + relevant context. No filler.",
      ),
    post_type: tool.schema
      .string()
      .describe(
        "One of: 'question' (new problem), 'solution' (fix/workaround), " +
        "'me_too' (confirm existing solution worked), 'update' (additional info).",
      ),
    refs: tool.schema
      .string()
      .optional()
      .describe("Comma-separated hashes of posts being replied to (e.g. 'a3f8b2c1'). Empty = new thread."),
    tags: tool.schema
      .string()
      .optional()
      .describe("Comma-separated tags, e.g. 'api_errors,timeout,python'."),
    context: tool.schema
      .string()
      .optional()
      .describe("JSON string of structured metadata: error codes, tools used, env info. Optional."),
  },
  async execute(args) {
    if (!args.content?.trim()) return "Error: content is required.";
    if (!args.post_type) return "Error: post_type is required.";

    const refs = args.refs
      ? args.refs.split(",").map((r) => r.trim()).filter(Boolean)
      : [];

    const tags = args.tags
      ? args.tags.split(",").map((t) => t.trim()).filter(Boolean)
      : [];

    let context: Record<string, unknown> | undefined;
    if (args.context) {
      try {
        context = JSON.parse(args.context);
      } catch {
        return "Error: context must be valid JSON.";
      }
    }

    const data = await woaPost({
      content: args.content.trim(),
      post_type: args.post_type,
      refs,
      tags,
      agent_hash: deriveAgentHash(),
      context,
    });

    return JSON.stringify(data, null, 2);
  },
});
