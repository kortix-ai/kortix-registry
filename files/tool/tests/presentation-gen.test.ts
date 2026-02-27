import { readFileSync, existsSync, rmSync } from "fs";
import { resolve, join } from "path";

const envPath = resolve(import.meta.dir, "../../.env");
for (const line of readFileSync(envPath, "utf-8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq > 0) process.env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
}

const OUTPUT_DIR = resolve(import.meta.dir, "test-output-presentations");

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

const presGen = (await import("../presentation-gen.ts")).default;

const ctx = { directory: process.cwd(), worktree: process.cwd() } as Parameters<
  typeof presGen.execute
>[1];

// ── Worktree "/" Fallback Test ──

await test("presentation_gen: worktree '/' falls back to directory", async () => {
  const rootCtx = { directory: OUTPUT_DIR, worktree: "/" } as Parameters<
    typeof presGen.execute
  >[1];
  const raw = await presGen.execute(
    {
      action: "create_slide",
      presentation_name: "worktree_test",
      slide_number: 1,
      slide_title: "Test",
      content: "<div>hello</div>",
      presentation_title: "Worktree Test",
    },
    rootCtx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `should succeed with worktree '/', got: ${raw}`);
  assert(
    result.presentation_path === "presentations/worktree_test",
    "path should be relative",
  );
  // Verify file was created under OUTPUT_DIR, not under /
  const slidePath = join(OUTPUT_DIR, result.slide_file);
  assert(existsSync(slidePath), `slide should exist at ${slidePath}, not at /${result.slide_file}`);
  // Cleanup
  rmSync(join(OUTPUT_DIR, "presentations"), { recursive: true, force: true });
});

// ── Validation Tests ──

await test("presentation_gen: invalid action", async () => {
  const raw = await presGen.execute({ action: "dance" } as any, ctx);
  assert(
    (raw as string).includes("Invalid action"),
    "should reject invalid action",
  );
});

await test("presentation_gen: create_slide missing presentation_name", async () => {
  const raw = await presGen.execute(
    {
      action: "create_slide",
      slide_number: 1,
      slide_title: "Test",
      content: "<div>hi</div>",
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === false, "should fail without presentation_name");
  assert(
    result.error.includes("presentation_name"),
    "should mention presentation_name",
  );
});

await test("presentation_gen: create_slide missing content", async () => {
  const raw = await presGen.execute(
    {
      action: "create_slide",
      presentation_name: "test",
      slide_number: 1,
      slide_title: "Test",
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === false, "should fail without content");
  assert(result.error.includes("content"), "should mention content");
});

await test("presentation_gen: create_slide missing slide_title", async () => {
  const raw = await presGen.execute(
    {
      action: "create_slide",
      presentation_name: "test",
      slide_number: 1,
      content: "<div>hi</div>",
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === false, "should fail without slide_title");
});

await test("presentation_gen: delete_slide invalid number", async () => {
  const raw = await presGen.execute(
    {
      action: "delete_slide",
      presentation_name: "nonexistent",
      slide_number: 1,
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === false, "should fail for nonexistent presentation");
});

// ── Functional Tests ──

const PRES_NAME = "test_presentation";

await test("presentation_gen: list_presentations (empty)", async () => {
  const raw = await presGen.execute(
    { action: "list_presentations", output_dir: OUTPUT_DIR },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, "should succeed");
  assert(result.total_count === 0, "should have 0 presentations initially");
});

await test("presentation_gen: create_slide 1", async () => {
  const raw = await presGen.execute(
    {
      action: "create_slide",
      presentation_name: PRES_NAME,
      slide_number: 1,
      slide_title: "Introduction",
      content: `<div style="display:flex;align-items:center;justify-content:center;height:1080px;width:1920px;background:#1a1a2e;">
  <h1 style="color:#e94560;font-size:72px;font-weight:900;">Test Presentation</h1>
</div>`,
      presentation_title: "Test Presentation",
      output_dir: OUTPUT_DIR,
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `should succeed: ${raw}`);
  assert(result.slide_number === 1, "slide_number should be 1");
  assert(result.total_slides === 1, "total_slides should be 1");

  const slidePath = join(OUTPUT_DIR, result.slide_file);
  assert(existsSync(slidePath), `slide file should exist: ${slidePath}`);

  const html = readFileSync(slidePath, "utf-8");
  assert(html.includes("1920"), "should have 1920 viewport");
  assert(html.includes("Inter"), "should have Inter font");
  assert(
    html.includes("Test Presentation"),
    "should contain presentation title",
  );
  assert(html.includes("#e94560"), "should contain slide content");
  process.stdout.write(`  created: ${slidePath}\n`);
});

await test("presentation_gen: create_slide 2", async () => {
  const raw = await presGen.execute(
    {
      action: "create_slide",
      presentation_name: PRES_NAME,
      slide_number: 2,
      slide_title: "Details",
      content: `<div style="padding:40px;box-sizing:border-box;height:1080px;width:1920px;background:#16213e;">
  <h2 style="color:#e94560;font-size:48px;">Key Points</h2>
  <ul style="color:#fff;font-size:24px;line-height:1.8;">
    <li>Point one</li>
    <li>Point two</li>
    <li>Point three</li>
  </ul>
</div>`,
      presentation_title: "Test Presentation",
      output_dir: OUTPUT_DIR,
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `should succeed: ${raw}`);
  assert(result.slide_number === 2, "slide_number should be 2");
  assert(result.total_slides === 2, "total_slides should be 2");
});

await test("presentation_gen: create_slide 3", async () => {
  const raw = await presGen.execute(
    {
      action: "create_slide",
      presentation_name: PRES_NAME,
      slide_number: 3,
      slide_title: "Conclusion",
      content: `<div style="display:flex;align-items:center;justify-content:center;height:1080px;width:1920px;background:#0f3460;">
  <h1 style="color:#e94560;font-size:64px;">Thank You</h1>
</div>`,
      presentation_title: "Test Presentation",
      output_dir: OUTPUT_DIR,
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `should succeed: ${raw}`);
  assert(result.total_slides === 3, "total_slides should be 3");
});

await test("presentation_gen: list_slides", async () => {
  const raw = await presGen.execute(
    {
      action: "list_slides",
      presentation_name: PRES_NAME,
      output_dir: OUTPUT_DIR,
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, "should succeed");
  assert(
    result.total_slides === 3,
    `should have 3 slides, got ${result.total_slides}`,
  );
  assert(result.slides[0].slide_number === 1, "first slide should be 1");
  assert(result.slides[1].slide_number === 2, "second slide should be 2");
  assert(result.slides[2].slide_number === 3, "third slide should be 3");
  assert(result.slides[0].title === "Introduction", "first slide title");
  process.stdout.write(`  ${result.total_slides} slides listed\n`);
});

await test("presentation_gen: list_presentations", async () => {
  const raw = await presGen.execute(
    { action: "list_presentations", output_dir: OUTPUT_DIR },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, "should succeed");
  assert(
    result.total_count === 1,
    `should have 1 presentation, got ${result.total_count}`,
  );
  assert(result.presentations[0].total_slides === 3, "should show 3 slides");
  assert(
    result.presentations[0].title === "Test Presentation",
    "title should match",
  );
  process.stdout.write(
    `  found: ${result.presentations[0].title} (${result.presentations[0].total_slides} slides)\n`,
  );
});

await test("presentation_gen: update existing slide", async () => {
  const raw = await presGen.execute(
    {
      action: "create_slide",
      presentation_name: PRES_NAME,
      slide_number: 2,
      slide_title: "Updated Details",
      content: `<div style="padding:40px;box-sizing:border-box;height:1080px;width:1920px;background:#16213e;">
  <h2 style="color:#e94560;font-size:48px;">Updated Content</h2>
</div>`,
      presentation_title: "Test Presentation",
      output_dir: OUTPUT_DIR,
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, "should succeed");
  assert(result.total_slides === 3, "total should still be 3 after update");

  const listRaw = await presGen.execute(
    {
      action: "list_slides",
      presentation_name: PRES_NAME,
      output_dir: OUTPUT_DIR,
    },
    ctx,
  );
  const listResult = JSON.parse(listRaw as string);
  assert(
    listResult.slides[1].title === "Updated Details",
    `slide 2 title should be updated, got: ${listResult.slides[1].title}`,
  );
});

await test("presentation_gen: delete_slide", async () => {
  const raw = await presGen.execute(
    {
      action: "delete_slide",
      presentation_name: PRES_NAME,
      slide_number: 3,
      output_dir: OUTPUT_DIR,
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, "should succeed");
  assert(result.deleted_slide === 3, "should have deleted slide 3");
  assert(
    result.remaining_slides === 2,
    `should have 2 remaining, got ${result.remaining_slides}`,
  );
});

await test("presentation_gen: metadata.json structure", async () => {
  const metaPath = join(
    OUTPUT_DIR,
    "presentations",
    "test_presentation",
    "metadata.json",
  );
  assert(existsSync(metaPath), "metadata.json should exist");
  const metadata = JSON.parse(readFileSync(metaPath, "utf-8"));
  assert(metadata.presentation_name === PRES_NAME, "name should match");
  assert(metadata.title === "Test Presentation", "title should match");
  assert(
    Object.keys(metadata.slides).length === 2,
    "should have 2 slides after deletion",
  );
  assert(metadata.slides["1"] !== undefined, "slide 1 should exist");
  assert(metadata.slides["2"] !== undefined, "slide 2 should exist");
  assert(metadata.slides["3"] === undefined, "slide 3 should not exist");
  assert(typeof metadata.created_at === "string", "should have created_at");
  assert(typeof metadata.updated_at === "string", "should have updated_at");
  process.stdout.write(
    `  metadata valid: ${Object.keys(metadata.slides).length} slides\n`,
  );
});

await test("presentation_gen: images dir created", async () => {
  const imagesDir = join(OUTPUT_DIR, "presentations", "images");
  assert(
    existsSync(imagesDir),
    "presentations/images/ should be created automatically",
  );
});

await test("presentation_gen: delete_presentation", async () => {
  const raw = await presGen.execute(
    {
      action: "delete_presentation",
      presentation_name: PRES_NAME,
      output_dir: OUTPUT_DIR,
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, "should succeed");

  const listRaw = await presGen.execute(
    { action: "list_presentations", output_dir: OUTPUT_DIR },
    ctx,
  );
  const listResult = JSON.parse(listRaw as string);
  assert(
    listResult.total_count === 0,
    "should have 0 presentations after deletion",
  );
});

// ── Cleanup ──

if (!process.argv.includes("--keep-output")) {
  try {
    rmSync(OUTPUT_DIR, { recursive: true, force: true });
  } catch {}
}

process.stdout.write("\n\nAll presentation-gen tests passed!\n");
