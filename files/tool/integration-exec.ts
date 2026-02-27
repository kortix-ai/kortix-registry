import { tool } from "@opencode-ai/plugin";
import { getEnv } from "./lib/get-env";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

const PROXY_FETCH_PREAMBLE = `
// ── Auto-injected proxy fetch ──────────────────────────────────────────────
// Use proxyFetch(url, init) for all authenticated API calls.
// It works like fetch() but auth is injected automatically by the proxy.
const __PROXY_URL__ = process.env.__PROXY_URL__;
const __APP_SLUG__ = process.env.__APP_SLUG__;

globalThis.proxyFetch = async function proxyFetch(url, init = {}) {
  const method = (init.method || 'GET').toUpperCase();

  // Collect headers (skip auth — proxy handles it)
  const headers = {};
  if (init.headers) {
    const h = init.headers instanceof Headers
      ? Object.fromEntries(init.headers.entries())
      : init.headers;
    for (const [k, v] of Object.entries(h)) {
      if (k.toLowerCase() !== 'authorization') headers[k] = v;
    }
  }

  // Parse body — proxy expects a JSON-serializable object
  let body = undefined;
  if (init.body != null) {
    if (typeof init.body === 'string') {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    } else {
      body = init.body;
    }
  }

  const proxyRes = await fetch(__PROXY_URL__, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(getEnv('INTERNAL_SERVICE_KEY') ? { Authorization: 'Bearer ' + getEnv('INTERNAL_SERVICE_KEY') } : {}),
    },
    body: JSON.stringify({
      app: __APP_SLUG__,
      method,
      url,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body,
    }),
  });

  if (!proxyRes.ok) {
    const errText = await proxyRes.text();
    throw new Error('Proxy error (' + proxyRes.status + '): ' + errText);
  }

  const data = await proxyRes.json();
  const status = data.status || 200;
  const ok = status >= 200 && status < 400;
  const responseBody = data.body;

  // Return a Response-like object
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    headers: new Map(Object.entries(data.headers || {})),
    json: async () => responseBody,
    text: async () => typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody),
  };
};
// ── End proxy fetch ────────────────────────────────────────────────────────
`;

export default tool({
  description:
    "Execute Node.js code that calls an authenticated third-party API. " +
    "Auth is handled automatically — use the global `proxyFetch(url, init)` function " +
    "instead of `fetch()` for any API call that needs the user's OAuth credentials. " +
    "It works exactly like fetch() but injects auth server-side via the integration proxy. " +
    "You can still use regular `fetch()` for non-authenticated requests. " +
    "IMPORTANT: Never try to set Authorization headers — the proxy handles it.",
  args: {
    app: tool.schema
      .string()
      .describe(
        "The integration app slug (e.g. 'gmail', 'google_sheets', 'slack', 'github')",
      ),
    code: tool.schema
      .string()
      .describe(
        "Node.js code to execute. Use `proxyFetch(url, init)` for authenticated API calls — " +
        "it works like fetch() but auth is injected automatically. " +
        "Use regular `fetch()` for non-authenticated requests. " +
        "Output results via console.log().",
      ),
  },
  async execute(args) {
    const masterUrl =
      process.env.KORTIX_MASTER_URL || "http://localhost:8000";
    const proxyUrl = `${masterUrl}/api/integrations/proxy`;

    const fullCode = PROXY_FETCH_PREAMBLE + "\n" + args.code;

    const tmpDir = "/tmp";
    const tmpFile = join(
      tmpDir,
      `.integration_exec_${Date.now()}.mjs`,
    );

    try {
      writeFileSync(tmpFile, fullCode, "utf-8");
    } catch (err) {
      return JSON.stringify(
        { success: false, error: `Failed to write temp file: ${err}` },
        null,
        2,
      );
    }

    try {
      const result = spawnSync("node", [tmpFile], {
        env: {
          ...process.env,
          __PROXY_URL__: proxyUrl,
          __APP_SLUG__: args.app,
        },
        timeout: 30_000,
        maxBuffer: 1024 * 1024, 
        encoding: "utf-8",
      });

      const stdout = result.stdout || "";
      const stderr = result.stderr || "";
      const exitCode = result.status ?? -1;

      return JSON.stringify(
        {
          success: exitCode === 0,
          exit_code: exitCode,
          stdout: stdout.slice(0, 10_000),
          stderr: stderr.slice(0, 5_000),
        },
        null,
        2,
      );
    } catch (err) {
      return JSON.stringify(
        { success: false, error: `Execution failed: ${err}` },
        null,
        2,
      );
    } finally {
      try {
        unlinkSync(tmpFile);
      } catch {
      }
    }
  },
});
