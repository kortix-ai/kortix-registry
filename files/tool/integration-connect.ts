import { tool } from "@opencode-ai/plugin";
import { getEnv } from "./lib/get-env";

/**
 * Connect a third-party app via OAuth.
 * Returns a dashboard URL that auto-triggers the Pipedream SDK connect popup.
 */
export default tool({
  description:
    "Connect a third-party app (OAuth) so the agent can use it. " +
    "Returns a dashboard URL the user clicks — it opens the OAuth popup automatically. " +
    "After the user authorizes, the integration becomes available. " +
    "Use integration_search first to find the correct app slug if unsure. " +
    "Example: app='gmail' → returns a URL → user clicks → OAuth popup → Gmail connected.",
  args: {
    app: tool.schema
      .string()
      .describe(
        "The app slug to connect (e.g. 'gmail', 'google_sheets', 'slack', 'github'). " +
        "Use integration_search to find the correct slug.",
      ),
  },
  async execute(args) {
    const masterUrl = process.env.KORTIX_MASTER_URL || "http://localhost:8000";

    try {
      const res = await fetch(`${masterUrl}/api/integrations/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(getEnv('INTERNAL_SERVICE_KEY') ? { Authorization: `Bearer ${getEnv('INTERNAL_SERVICE_KEY')}` } : {}),
        },
        body: JSON.stringify({ app: args.app }),
      });

      if (!res.ok) {
        const err = await res.text();
        return JSON.stringify(
          {
            success: false,
            error: `Failed to create connect URL (${res.status}): ${err}`,
            hint: "Check the app slug is correct. Use integration_search to find valid slugs.",
          },
          null,
          2,
        );
      }

      const data = (await res.json()) as {
        connectUrl?: string;
        token: string;
        app: string;
      };

      if (!data.connectUrl) {
        return JSON.stringify(
          {
            success: false,
            error: "No connect URL returned from provider",
            hint: "The app may not support OAuth connections.",
          },
          null,
          2,
        );
      }

      return JSON.stringify(
        {
          success: true,
          app: data.app,
          connectUrl: data.connectUrl,
          message:
            `Please click this link to connect ${data.app}: ${data.connectUrl}\n` +
            "After authorizing, the integration will be available automatically. " +
            "Use integration_list to verify the connection.",
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
