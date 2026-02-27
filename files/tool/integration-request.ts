import { tool } from "@opencode-ai/plugin";
import { getEnv } from "./lib/get-env";

export default tool({
  description:
    "Make an authenticated HTTP request to a third-party API on behalf of the user. " +
    "The user's OAuth credentials are injected automatically — you never see the token. " +
    "Specify the app slug, HTTP method, full URL, optional headers, and optional JSON body. " +
    "Use integration_list first to check which apps are available.",
  args: {
    app: tool.schema
      .string()
      .describe(
        "The integration app slug (e.g. 'gmail', 'google_sheets', 'slack', 'github')",
      ),
    method: tool.schema
      .string()
      .optional()
      .describe("HTTP method: GET, POST, PUT, PATCH, DELETE (default: GET)"),
    url: tool.schema
      .string()
      .describe(
        "The full API URL to call (e.g. 'https://gmail.googleapis.com/gmail/v1/users/me/messages')",
      ),
    headers: tool.schema
      .record(tool.schema.string(), tool.schema.string())
      .optional()
      .describe("Optional additional headers (auth is injected automatically)"),
    body: tool.schema
      .unknown()
      .optional()
      .describe("Optional JSON body for POST/PUT/PATCH requests"),
  },
  async execute(args) {
    const masterUrl =
      process.env.KORTIX_MASTER_URL || "http://localhost:8000";
    const method = args.method || "GET";

    try {
      const res = await fetch(`${masterUrl}/api/integrations/proxy`, {
        method: "POST",
         headers: {
          "Content-Type": "application/json",
          ...(getEnv('INTERNAL_SERVICE_KEY') ? { Authorization: `Bearer ${getEnv('INTERNAL_SERVICE_KEY')}` } : {}),
        },
        body: JSON.stringify({
          app: args.app,
          method,
          url: args.url,
          headers: args.headers,
          body: args.body,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        return JSON.stringify(
          {
            success: false,
            error: `Proxy request failed (${res.status}): ${err}`,
            hint:
              res.status === 403
                ? "Ask the user to connect this integration from the Kortix dashboard and link it to this sandbox."
                : "Check the URL and try again.",
          },
          null,
          2,
        );
      }

      const data = (await res.json()) as {
        status: number;
        body: unknown;
      };

      return JSON.stringify(
        {
          success: data.status >= 200 && data.status < 400,
          status: data.status,
          data: data.body,
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
