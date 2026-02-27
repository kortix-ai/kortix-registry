import { tool } from "@opencode-ai/plugin";
import { getEnv } from "./lib/get-env";

/**
 * Cron Triggers tool — lets agents create, list, update, delete, pause, resume,
 * and manually run scheduled tasks via the Kortix platform API.
 *
 * Env vars used:
 *   KORTIX_API_URL  — e.g. https://new-api.kortix.com (base URL, no path)
 *   KORTIX_TOKEN    — kortix_sb_xxx sandbox token
 */

function getCronUrl(): string {
  const apiUrl = getEnv("KORTIX_API_URL") || "http://localhost:8008";
  return `${apiUrl.replace(/\/+$/, "")}/v1/cron`;
}

function getToken(): string | undefined {
  return getEnv("KORTIX_TOKEN") || undefined;
}

async function cronFetch(
  path: string,
  method: string = "GET",
  body?: Record<string, unknown>,
): Promise<unknown> {
  const url = `${getCronUrl()}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  // Auth is always required — kortix_ sandbox token or Supabase JWT.
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} failed: ${res.status} ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return { status: res.status, body: text };
  }
}

async function getSandboxId(): Promise<string> {
  const data = (await cronFetch("/sandboxes")) as {
    data: { sandboxId: string }[];
  };
  const first = data.data?.[0];
  if (!first) {
    throw new Error("No sandboxes found for this account");
  }
  return first.sandboxId;
}

export default tool({
  description:
    "Manage scheduled cron triggers on the Kortix platform. " +
    "Actions: 'create' (schedule a new recurring task), 'list' (show all triggers), " +
    "'get' (get trigger details), 'update' (modify a trigger), 'delete' (remove a trigger), " +
    "'pause' (stop a trigger), 'resume' (re-enable a trigger), 'run' (fire immediately), " +
    "'executions' (view execution history). " +
    "Use this when the user asks to schedule tasks, set up cron jobs, automate recurring work, " +
    "or manage existing scheduled tasks.",
  args: {
    action: tool.schema
      .string()
      .describe(
        "Action: 'create', 'list', 'get', 'update', 'delete', 'pause', 'resume', 'run', 'executions'",
      ),
    trigger_id: tool.schema
      .string()
      .optional()
      .describe(
        "Trigger UUID. Required for: get, update, delete, pause, resume, run, executions",
      ),
    name: tool.schema
      .string()
      .optional()
      .describe("Human-readable name for the task. Required for 'create'."),
    cron_expr: tool.schema
      .string()
      .optional()
      .describe(
        "6-field cron expression: 'second minute hour day month weekday'. " +
          "Examples: '0 0 9 * * *' (daily 9 AM), '0 */5 * * * *' (every 5 min), " +
          "'0 0 8 * * 1' (Monday 8 AM). Required for 'create'.",
      ),
    prompt: tool.schema
      .string()
      .optional()
      .describe(
        "The instruction sent to the agent on each run. Required for 'create'.",
      ),
    timezone: tool.schema
      .string()
      .optional()
      .describe("IANA timezone, e.g. 'UTC', 'America/New_York'. Default: UTC."),
    agent_name: tool.schema
      .string()
      .optional()
      .describe("Agent to run the task, e.g. 'kortix'. Default: the default agent."),
    model_id: tool.schema
      .string()
      .optional()
      .describe(
        "Model to use: 'kortix/basic' (Sonnet, default) or 'kortix/power' (Opus 4.6).",
      ),
    session_mode: tool.schema
      .string()
      .optional()
      .describe("'new' (fresh session each run, default) or 'reuse' (continue existing session)."),
  },
  async execute(args, _context) {
    try {
      const { action } = args;

      switch (action) {
        case "create": {
          if (!args.name) return "Error: 'name' is required for create.";
          if (!args.cron_expr) return "Error: 'cron_expr' is required for create.";
          if (!args.prompt) return "Error: 'prompt' is required for create.";

          const sandboxId = await getSandboxId();
          const body: Record<string, unknown> = {
            sandbox_id: sandboxId,
            name: args.name,
            cron_expr: args.cron_expr,
            prompt: args.prompt,
          };
          if (args.timezone) body.timezone = args.timezone;
          if (args.agent_name) body.agent_name = args.agent_name;
          if (args.session_mode) body.session_mode = args.session_mode;
          if (args.model_id) {
            body.model_provider_id = "kortix";
            body.model_id = args.model_id;
          }

          const result = await cronFetch("/triggers", "POST", body);
          return JSON.stringify(result, null, 2);
        }

        case "list": {
          const result = await cronFetch("/triggers");
          return JSON.stringify(result, null, 2);
        }

        case "get": {
          if (!args.trigger_id) return "Error: 'trigger_id' is required.";
          const result = await cronFetch(`/triggers/${args.trigger_id}`);
          return JSON.stringify(result, null, 2);
        }

        case "update": {
          if (!args.trigger_id) return "Error: 'trigger_id' is required.";
          const body: Record<string, unknown> = {};
          if (args.name) body.name = args.name;
          if (args.cron_expr) body.cron_expr = args.cron_expr;
          if (args.prompt) body.prompt = args.prompt;
          if (args.timezone) body.timezone = args.timezone;
          if (args.agent_name !== undefined) body.agent_name = args.agent_name || null;
          if (args.session_mode) body.session_mode = args.session_mode;
          if (args.model_id) {
            body.model_provider_id = "kortix";
            body.model_id = args.model_id;
          }

          if (Object.keys(body).length === 0) {
            return "Error: provide at least one field to update.";
          }

          const result = await cronFetch(
            `/triggers/${args.trigger_id}`,
            "PATCH",
            body,
          );
          return JSON.stringify(result, null, 2);
        }

        case "delete": {
          if (!args.trigger_id) return "Error: 'trigger_id' is required.";
          const result = await cronFetch(
            `/triggers/${args.trigger_id}`,
            "DELETE",
          );
          return JSON.stringify(result, null, 2);
        }

        case "pause": {
          if (!args.trigger_id) return "Error: 'trigger_id' is required.";
          const result = await cronFetch(
            `/triggers/${args.trigger_id}/pause`,
            "POST",
          );
          return JSON.stringify(result, null, 2);
        }

        case "resume": {
          if (!args.trigger_id) return "Error: 'trigger_id' is required.";
          const result = await cronFetch(
            `/triggers/${args.trigger_id}/resume`,
            "POST",
          );
          return JSON.stringify(result, null, 2);
        }

        case "run": {
          if (!args.trigger_id) return "Error: 'trigger_id' is required.";
          const result = await cronFetch(
            `/triggers/${args.trigger_id}/run`,
            "POST",
          );
          return JSON.stringify(result, null, 2);
        }

        case "executions": {
          if (!args.trigger_id) return "Error: 'trigger_id' is required.";
          const result = await cronFetch(
            `/executions/by-trigger/${args.trigger_id}`,
          );
          return JSON.stringify(result, null, 2);
        }

        default:
          return `Error: Unknown action '${action}'. Use: create, list, get, update, delete, pause, resume, run, executions.`;
      }
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
});
