import { tool } from "@opencode-ai/plugin";
import { getEnv } from "./lib/get-env";

/**
 * Search available apps that can be connected via OAuth.
 * Use this to find the correct app slug before calling integration_connect.
 */
export default tool({
  description:
    "Search for available third-party apps that can be connected via OAuth. " +
    "Returns app slugs, names, and descriptions. " +
    "Use this to find the correct app slug before calling integration_connect. " +
    "Example: q='gmail' → finds Gmail with slug 'gmail'.",
  args: {
    q: tool.schema
      .string()
      .optional()
      .describe("Search query to filter apps (e.g. 'gmail', 'slack', 'spreadsheet')"),
  },
  async execute(args) {
    const masterUrl = process.env.KORTIX_MASTER_URL || "http://localhost:8000";

    try {
      const params = new URLSearchParams();
      if (args.q) params.set("q", args.q);
      params.set("limit", "20");

      const res = await fetch(
        `${masterUrl}/api/integrations/search-apps?${params.toString()}`,
        {
          headers: {
            "Content-Type": "application/json",
            ...(getEnv('INTERNAL_SERVICE_KEY') ? { Authorization: `Bearer ${getEnv('INTERNAL_SERVICE_KEY')}` } : {}),
          },
        },
      );

      if (!res.ok) {
        const err = await res.text();
        return JSON.stringify(
          {
            success: false,
            error: `Failed to search apps (${res.status}): ${err}`,
          },
          null,
          2,
        );
      }

      const data = (await res.json()) as {
        apps: Array<{
          slug: string;
          name: string;
          description?: string;
          categories: string[];
        }>;
        pageInfo: { totalCount: number; count: number; hasMore: boolean };
      };

      if (!data.apps || data.apps.length === 0) {
        return JSON.stringify(
          {
            success: true,
            apps: [],
            message: `No apps found${args.q ? ` matching "${args.q}"` : ""}. Try a different search query.`,
          },
          null,
          2,
        );
      }

      const compact = data.apps.map((a) => ({
        slug: a.slug,
        name: a.name,
        description: a.description,
      }));

      return JSON.stringify(
        {
          success: true,
          apps: compact,
          totalCount: data.pageInfo.totalCount,
          message:
            `${compact.length} app(s) found. ` +
            "Use integration_connect with the app slug to connect one.",
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
