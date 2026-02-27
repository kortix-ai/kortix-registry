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

const scrapeWebpage = (await import("../scrape-webpage.ts")).default;

const ctx = { directory: process.cwd(), worktree: process.cwd() } as Parameters<
  typeof scrapeWebpage.execute
>[1];

await test("scrape_webpage: single URL", async () => {
  const raw = await scrapeWebpage.execute({ urls: "https://example.com" }, ctx);
  const result = JSON.parse(raw as string);
  assert(
    result.success === true,
    `expected success, got: ${JSON.stringify(result).slice(0, 200)}`,
  );
  assert(typeof result.content === "string", "should have content");
  assert(
    result.content_length > 0,
    `content should not be empty, got length=${result.content_length}`,
  );
  process.stdout.write(
    `  title: "${result.title}", ${result.content_length} chars\n`,
  );
});

await test("scrape_webpage: multiple URLs", async () => {
  const raw = await scrapeWebpage.execute(
    {
      urls: "https://example.com,https://httpbin.org/html",
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.total === 2, `expected 2 results, got ${result.total}`);
  assert(result.successful >= 1, "at least one should succeed");
  process.stdout.write(`  ${result.successful}/${result.total} succeeded\n`);
});

await test("scrape_webpage: missing API key", async () => {
  const saved = process.env.FIRECRAWL_API_KEY;
  delete process.env.FIRECRAWL_API_KEY;
  const raw = await scrapeWebpage.execute({ urls: "https://example.com" }, ctx);
  process.env.FIRECRAWL_API_KEY = saved;
  assert(
    (raw as string).includes("FIRECRAWL_API_KEY"),
    "should mention missing key",
  );
});

process.stdout.write("\n\nAll scrape-webpage tests passed!\n");
