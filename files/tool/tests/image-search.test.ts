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

const imageSearch = (await import("../image-search.ts")).default;

const ctx = { directory: process.cwd(), worktree: process.cwd() } as Parameters<
  typeof imageSearch.execute
>[1];

await test("image_search: single query (no enrich)", async () => {
  const raw = await imageSearch.execute(
    {
      query: "golden retriever puppy",
      num_results: 5,
      enrich: false,
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.total > 0, `expected images, got total=${result.total}`);
  assert(typeof result.images[0].url === "string", "image should have url");
  assert(typeof result.images[0].title === "string", "image should have title");
  assert(
    typeof result.images[0].source === "string",
    "image should have source",
  );
  assert(typeof result.images[0].width === "number", "image should have width");
  assert(
    typeof result.images[0].height === "number",
    "image should have height",
  );
  assert(
    typeof result.images[0].description === "string",
    "image should have description field",
  );
  process.stdout.write(`  ${result.total} images found\n`);
});

await test("image_search: batch query (no enrich)", async () => {
  const raw = await imageSearch.execute(
    {
      query: "sunset beach ||| mountain snow",
      num_results: 3,
      enrich: false,
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.batch_mode === true, "should be batch mode");
  assert(
    result.results.length === 2,
    `expected 2 batches, got ${result.results.length}`,
  );
  process.stdout.write(
    `  batch1: ${result.results[0].total} images, batch2: ${result.results[1].total} images\n`,
  );
});

const hasReplicate = !!process.env.REPLICATE_API_TOKEN;
if (hasReplicate) {
  await test("image_search: with Moondream2 enrichment", async () => {
    const raw = await imageSearch.execute(
      {
        query: "Eiffel Tower Paris",
        num_results: 2,
        enrich: true,
      },
      ctx,
    );
    const result = JSON.parse(raw as string);
    assert(result.total > 0, "should have images");
    const hasDescription = result.images.some(
      (img: Record<string, unknown>) =>
        typeof img.description === "string" &&
        (img.description as string).length > 0,
    );
    assert(
      hasDescription,
      "at least one image should have a Moondream2 description",
    );
    process.stdout.write(
      `  ${result.total} images, descriptions: ${result.images.map((i: Record<string, string>) => (i.description ?? "").slice(0, 60) + "...").join(" | ")}\n`,
    );
  });
} else {
  process.stdout.write(
    "\n=== image_search: Moondream2 enrichment ===\nSKIPPED (no REPLICATE_API_TOKEN)\n",
  );
}

await test("image_search: missing API key", async () => {
  const saved = process.env.SERPER_API_KEY;
  delete process.env.SERPER_API_KEY;
  const raw = await imageSearch.execute({ query: "test" }, ctx);
  process.env.SERPER_API_KEY = saved;
  assert(
    (raw as string).includes("SERPER_API_KEY"),
    "should mention missing key",
  );
});

process.stdout.write("\n\nAll image-search tests passed!\n");
