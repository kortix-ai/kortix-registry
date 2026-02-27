import { tool } from "@opencode-ai/plugin";
import { getEnv } from "./lib/get-env";

/**
 * List available Pipedream actions for a connected app.
 * Returns structured action keys and parameter definitions —
 * use these with integration_run to execute actions without guessing APIs.
 */
export default tool({
  description:
    "List available actions for a connected integration app. " +
    "Returns action keys and their required parameters. " +
    "Use this to discover what you can do with an app (e.g. 'gmail', 'slack', 'google_sheets') " +
    "before executing with integration_run. " +
    "Optionally filter by search query (e.g. q='send email').",
  args: {
    app: tool.schema
      .string()
      .describe(
        "The integration app slug (e.g. 'gmail', 'google_sheets', 'slack', 'github')",
      ),
    q: tool.schema
      .string()
      .optional()
      .describe("Optional search query to filter actions (e.g. 'send', 'create', 'list')"),
  },
  async execute(args) {
    const masterUrl = process.env.KORTIX_MASTER_URL || "http://localhost:8000";

    async function fetchActions(app: string, q?: string) {
      const params = new URLSearchParams();
      params.set("app", app);
      if (q) params.set("q", q);

      const res = await fetch(
        `${masterUrl}/api/integrations/actions?${params.toString()}`,
        {
           headers: {
            "Content-Type": "application/json",
            ...(getEnv('INTERNAL_SERVICE_KEY') ? { Authorization: `Bearer ${getEnv('INTERNAL_SERVICE_KEY')}` } : {}),
          },
        },
      );

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Failed to list actions (${res.status}): ${err}`);
      }

      return (await res.json()) as {
        actions: Array<{
          key: string;
          name: string;
          description?: string;
          params: Array<{
            name: string;
            type: string;
            required: boolean;
            description?: string;
          }>;
        }>;
        app: string;
      };
    }

    try {
      let data = await fetchActions(args.app, args.q);

      // Auto-retry without query filter if filtered search returned no results
      if ((!data.actions || data.actions.length === 0) && args.q) {
        data = await fetchActions(args.app);
      }

      if (!data.actions || data.actions.length === 0) {
        return JSON.stringify(
          {
            success: true,
            app: args.app,
            actions: [],
            message: `No actions found for "${args.app}". Check the app slug with integration_search.`,
          },
          null,
          2,
        );
      }

      // Compact output for token efficiency
      const compact = data.actions.map((a) => ({
        key: a.key,
        name: a.name,
        description: a.description,
        required_params: a.params
          .filter((p) => p.required)
          .map((p) => `${p.name} (${p.type})`),
        optional_params: a.params
          .filter((p) => !p.required)
          .map((p) => `${p.name} (${p.type})`),
      }));

      return JSON.stringify(
        {
          success: true,
          app: args.app,
          actions: compact,
          message: `${compact.length} action(s) found. Use integration_run with a key and props to execute.`,
        },
        null,
        2,
      );
    } catch (err) {
      return JSON.stringify(
        {
          success: false,
          error: `Failed to reach integration service: ${err}`,
          hint: "Make sure the app slug is correct. Use integration_search to find slugs, integration_connect to connect apps.",
        },
        null,
        2,
      );
    }
  },
});
