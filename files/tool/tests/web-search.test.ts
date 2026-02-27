import { readFileSync } from "fs";
import { resolve } from "path";

const envPath = resolve(import.meta.dir, "../../.env");
for (const line of readFileSync(envPath, "utf-8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq > 0) process.env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
}

async function test(name: string, fn: () => Promise<void>) {
  process.stdout.write(`\n=== ${name} ===\n`);
  try {
    await fn();
    process.stdout.write(`PASS\n`);
  } catch (e) {
    process.stdout.write(`FAIL: ${e}\n`);
    process.exit(1);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const webSearch = (await import("../web-search.ts")).default;

const ctx = { directory: process.cwd(), worktree: process.cwd() } as Parameters<
  typeof webSearch.execute
>[1];

await test("web_search: single query", async () => {
  const raw = await webSearch.execute(
    { query: "OpenCode AI coding agent" },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(
    result.success === true,
    `expected success, got: ${JSON.stringify(result).slice(0, 200)}`,
  );
  assert(Array.isArray(result.results), "results should be array");
  assert(result.results.length > 0, "should have results");
  assert(
    typeof result.results[0].title === "string",
    "result should have title",
  );
  assert(typeof result.results[0].url === "string", "result should have url");
  assert(
    typeof result.results[0].score === "number",
    "result should have score",
  );
  assert(typeof result.answer === "string", "should have answer");
  process.stdout.write(
    `  ${result.results.length} results, answer: ${(result.answer as string).slice(0, 80)}...\n`,
  );
});

await test("web_search: batch query", async () => {
  const raw = await webSearch.execute(
    {
      query: "TypeScript 2025 ||| Bun runtime",
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.batch_mode === true, "should be batch mode");
  assert(
    result.results.length === 2,
    `expected 2 results, got ${result.results.length}`,
  );
  assert(result.results[0].query === "TypeScript 2025", "first query mismatch");
  assert(result.results[1].query === "Bun runtime", "second query mismatch");
  process.stdout.write(
    `  query1: ${result.results[0].results.length} results, query2: ${result.results[1].results.length} results\n`,
  );
});

await test("web_search: topic param", async () => {
  const raw = await webSearch.execute(
    {
      query: "latest AI news",
      topic: "news",
      num_results: 3,
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, "news search should succeed");
  assert(result.results.length > 0, "should have news results");
  process.stdout.write(`  ${result.results.length} news results\n`);
});

await test("web_search: missing API key", async () => {
  const saved = process.env.TAVILY_API_KEY;
  delete process.env.TAVILY_API_KEY;
  const raw = await webSearch.execute({ query: "test" }, ctx);
  process.env.TAVILY_API_KEY = saved;
  assert(
    (raw as string).includes("TAVILY_API_KEY"),
    "should mention missing key",
  );
});

process.stdout.write("\n\nAll web-search tests passed!\n");
