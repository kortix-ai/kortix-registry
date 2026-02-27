/**
 * E2E test for the presentation-gen EACCES fix.
 *
 * Simulates the exact Docker sandbox scenario:
 *   - _context.worktree = "/"  (no git repo)
 *   - _context.directory = process.cwd()  (e.g. /workspace)
 *   - NO output_dir provided
 *
 * Verifies that slides are created under cwd, not under "/presentations".
 */
import { existsSync, rmSync, readFileSync } from "fs";
import { resolve, join } from "path";

// ── Helpers ──

function pass(name: string) {
  process.stdout.write(`  PASS  ${name}\n`);
}
function fail(name: string, reason: string) {
  process.stdout.write(`  FAIL  ${name}: ${reason}\n`);
  process.exit(1);
}
function assert(cond: boolean, name: string, reason: string) {
  if (cond) pass(name);
  else fail(name, reason);
}

// ── Setup ──

const TEST_DIR = resolve(import.meta.dir, "e2e-output");
rmSync(TEST_DIR, { recursive: true, force: true });

// Import the tool
const presGen = (await import("../presentation-gen.ts")).default;

process.stdout.write("\n=== E2E: presentation-gen EACCES fix ===\n\n");

// ── Test 1: worktree="/" without output_dir should NOT try to mkdir /presentations ──

process.stdout.write("Test 1: worktree='/' falls back to _context.directory\n");
{
  const ctx = { directory: TEST_DIR, worktree: "/" } as Parameters<
    typeof presGen.execute
  >[1];

  const raw = await presGen.execute(
    {
      action: "create_slide",
      presentation_name: "e2e_test",
      slide_number: 1,
      slide_title: "Title Slide",
      content:
        '<div style="width:1920px;height:1080px;background:#111;display:flex;align-items:center;justify-content:center;"><h1 style="color:#fff;font-size:64px;">E2E Test</h1></div>',
      presentation_title: "E2E Test Presentation",
      // NOTE: no output_dir — this is the bug scenario
    },
    ctx,
  );

  const result = JSON.parse(raw as string);
  assert(result.success === true, "create_slide succeeds", `got: ${raw}`);
  assert(
    result.presentation_path === "presentations/e2e_test",
    "presentation_path is relative",
    `got: ${result.presentation_path}`,
  );

  // Verify the file was created under TEST_DIR, not under /
  const slidePath = join(TEST_DIR, result.slide_file);
  assert(
    existsSync(slidePath),
    `slide file exists at ${slidePath}`,
    "file not found",
  );
  assert(
    !existsSync("/presentations/e2e_test"),
    "nothing created at /presentations/e2e_test",
    "files were incorrectly created at filesystem root!",
  );

  // Verify HTML content
  const html = readFileSync(slidePath, "utf-8");
  assert(html.includes("1920"), "slide has 1920 viewport", "missing viewport");
  assert(html.includes("E2E Test"), "slide has content", "missing content");
}

// ── Test 2: Create multiple slides in "parallel" (sequential but no output_dir) ──

process.stdout.write("\nTest 2: Multiple slides without output_dir\n");
{
  const ctx = { directory: TEST_DIR, worktree: "/" } as Parameters<
    typeof presGen.execute
  >[1];

  for (let i = 2; i <= 5; i++) {
    const raw = await presGen.execute(
      {
        action: "create_slide",
        presentation_name: "e2e_test",
        slide_number: i,
        slide_title: `Slide ${i}`,
        content: `<div style="width:1920px;height:1080px;background:#222;padding:60px;box-sizing:border-box;"><h2 style="color:#0ff;font-size:48px;">Slide ${i}</h2></div>`,
        presentation_title: "E2E Test Presentation",
      },
      ctx,
    );
    const result = JSON.parse(raw as string);
    assert(
      result.success === true,
      `slide ${i} created`,
      `failed: ${raw}`,
    );
  }

  // Verify all 5 slides exist
  const listRaw = await presGen.execute(
    { action: "list_slides", presentation_name: "e2e_test" },
    ctx,
  );
  const listResult = JSON.parse(listRaw as string);
  assert(
    listResult.total_slides === 5,
    `list_slides returns 5`,
    `got ${listResult.total_slides}`,
  );
}

// ── Test 3: images/ directory created correctly ──

process.stdout.write("\nTest 3: images/ directory created under correct path\n");
{
  const imagesDir = join(TEST_DIR, "presentations", "images");
  assert(existsSync(imagesDir), "images/ dir exists under TEST_DIR", "not found");
  assert(
    !existsSync("/presentations/images"),
    "no images/ at filesystem root",
    "images dir incorrectly at /",
  );
}

// ── Test 4: metadata.json is correct ──

process.stdout.write("\nTest 4: metadata.json structure\n");
{
  const metaPath = join(TEST_DIR, "presentations", "e2e_test", "metadata.json");
  assert(existsSync(metaPath), "metadata.json exists", "not found");
  const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
  assert(
    meta.presentation_name === "e2e_test",
    "presentation_name correct",
    `got: ${meta.presentation_name}`,
  );
  assert(
    meta.title === "E2E Test Presentation",
    "title correct",
    `got: ${meta.title}`,
  );
  assert(
    Object.keys(meta.slides).length === 5,
    "5 slides in metadata",
    `got: ${Object.keys(meta.slides).length}`,
  );
}

// ── Test 5: viewer.html generated ──

process.stdout.write("\nTest 5: viewer.html generated\n");
{
  const viewerPath = join(TEST_DIR, "presentations", "e2e_test", "viewer.html");
  // viewer.html depends on the skill template existing — might not in test env
  if (existsSync(viewerPath)) {
    pass("viewer.html exists");
  } else {
    process.stdout.write("  SKIP  viewer.html (skill template not available in test env)\n");
  }
}

// ── Test 6: list_presentations works ──

process.stdout.write("\nTest 6: list_presentations\n");
{
  const ctx = { directory: TEST_DIR, worktree: "/" } as Parameters<
    typeof presGen.execute
  >[1];
  const raw = await presGen.execute(
    { action: "list_presentations" },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, "list succeeds", `got: ${raw}`);
  assert(
    result.total_count === 1,
    "1 presentation found",
    `got: ${result.total_count}`,
  );
  assert(
    result.presentations[0].total_slides === 5,
    "presentation has 5 slides",
    `got: ${result.presentations[0].total_slides}`,
  );
}

// ── Test 7: delete_slide works ──

process.stdout.write("\nTest 7: delete_slide\n");
{
  const ctx = { directory: TEST_DIR, worktree: "/" } as Parameters<
    typeof presGen.execute
  >[1];
  const raw = await presGen.execute(
    { action: "delete_slide", presentation_name: "e2e_test", slide_number: 5 },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, "delete succeeds", `got: ${raw}`);
  assert(
    result.remaining_slides === 4,
    "4 slides remaining",
    `got: ${result.remaining_slides}`,
  );
}

// ── Test 8: delete_presentation works ──

process.stdout.write("\nTest 8: delete_presentation\n");
{
  const ctx = { directory: TEST_DIR, worktree: "/" } as Parameters<
    typeof presGen.execute
  >[1];
  const raw = await presGen.execute(
    { action: "delete_presentation", presentation_name: "e2e_test" },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, "delete presentation succeeds", `got: ${raw}`);

  const presDir = join(TEST_DIR, "presentations", "e2e_test");
  assert(!existsSync(presDir), "presentation dir removed", "still exists");
}

// ── Test 9: worktree with valid path still works (non-"/" case) ──

process.stdout.write("\nTest 9: valid worktree still works\n");
{
  const ctx = { directory: "/tmp", worktree: TEST_DIR } as Parameters<
    typeof presGen.execute
  >[1];
  const raw = await presGen.execute(
    {
      action: "create_slide",
      presentation_name: "worktree_pres",
      slide_number: 1,
      slide_title: "Valid Worktree",
      content: '<div style="width:1920px;height:1080px;background:#333;"><h1 style="color:#fff;">Worktree Test</h1></div>',
      presentation_title: "Worktree Test",
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, "create with valid worktree", `got: ${raw}`);
  // Should use worktree (TEST_DIR), not directory (/tmp)
  const slidePath = join(TEST_DIR, result.slide_file);
  assert(existsSync(slidePath), "file under worktree dir", "not found");
  assert(
    !existsSync(join("/tmp", result.slide_file)),
    "not under /tmp",
    "incorrectly used directory instead of worktree",
  );
  // Cleanup
  rmSync(join(TEST_DIR, "presentations", "worktree_pres"), { recursive: true, force: true });
}

// ── Cleanup ──

rmSync(TEST_DIR, { recursive: true, force: true });

process.stdout.write("\n=== All E2E tests passed! ===\n\n");
