import { tool } from "@opencode-ai/plugin";
import { getEnv } from "./lib/get-env";

/**
 * Execute a Pipedream action with structured parameters.
 * No raw API URLs or encoding needed — auth is handled server-side.
 * Use integration_actions first to discover available action keys and params.
 */
export default tool({
  description:
    "Execute a Pipedream action for a connected integration. " +
    "Provide the app slug, action key (from integration_actions), and structured props. " +
    "Auth and API details are handled automatically — no URLs or encoding needed. " +
    "Example: app='gmail', action_key='gmail-send-email', props={to, subject, body}.",
  args: {
    app: tool.schema
      .string()
      .describe(
        "The integration app slug (e.g. 'gmail', 'google_sheets', 'slack', 'github')",
      ),
    action_key: tool.schema
      .string()
      .describe(
        "The action key from integration_actions (e.g. 'gmail-send-email', 'slack-send-message')",
      ),
    props: tool.schema
      .record(tool.schema.string(), tool.schema.unknown())
      .optional()
      .describe(
        "Action parameters as key-value pairs. Use integration_actions to discover required params.",
      ),
  },
  async execute(args) {
    const masterUrl = process.env.KORTIX_MASTER_URL || "http://localhost:8000";

    try {
      const res = await fetch(`${masterUrl}/api/integrations/run-action`, {
        method: "POST",
         headers: {
          "Content-Type": "application/json",
          ...(getEnv('INTERNAL_SERVICE_KEY') ? { Authorization: `Bearer ${getEnv('INTERNAL_SERVICE_KEY')}` } : {}),
        },
        body: JSON.stringify({
          app: args.app,
          action_key: args.action_key,
          props: args.props || {},
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        return JSON.stringify(
          {
            success: false,
            error: `Action execution failed (${res.status}): ${err}`,
            hint:
              res.status === 403
                ? "This integration is not connected. Use integration_connect({app: '...'}) to connect it first."
                : res.status === 400
                  ? "Check the action_key and props. Use integration_actions to see valid keys and required params."
                  : "Check the action key and try again.",
          },
          null,
          2,
        );
      }

      const data = (await res.json()) as {
        success: boolean;
        result?: unknown;
        error?: string;
      };

      if (!data.success) {
        return JSON.stringify(
          {
            success: false,
            error: data.error || "Action execution failed",
            hint: "Check the props and try again. Use integration_actions to verify required parameters.",
          },
          null,
          2,
        );
      }

      return JSON.stringify(
        {
          success: true,
          result: data.result,
        },
        null,
        2,
      );
    } catch (err) {
      return JSON.stringify(
        {
          success: false,
          error: `Failed to reach integration service: ${err}`,
        },
        null,
        2,
      );
    }
  },
});
