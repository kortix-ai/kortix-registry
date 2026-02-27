import { readFileSync, existsSync, rmSync } from "fs";
import { resolve } from "path";

const envPath = resolve(import.meta.dir, "../../.env");
for (const line of readFileSync(envPath, "utf-8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq > 0) process.env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
}

const OUTPUT_DIR = resolve(import.meta.dir, "test-output");

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

const imageGen = (await import("../image-gen.ts")).default;

const ctx = { directory: process.cwd(), worktree: process.cwd() } as Parameters<
  typeof imageGen.execute
>[1];

// ── Validation Tests (no API calls) ──

await test("image_gen: missing API key", async () => {
  const saved = process.env.REPLICATE_API_TOKEN;
  delete process.env.REPLICATE_API_TOKEN;
  const raw = await imageGen.execute(
    { action: "generate", prompt: "test" },
    ctx,
  );
  process.env.REPLICATE_API_TOKEN = saved;
  assert(
    (raw as string).includes("REPLICATE_API_TOKEN"),
    "should mention missing key",
  );
});

await test("image_gen: invalid action", async () => {
  const raw = await imageGen.execute({ action: "dance" }, ctx);
  assert(
    (raw as string).includes("Invalid action"),
    "should reject invalid action",
  );
});

await test("image_gen: generate without prompt", async () => {
  const raw = await imageGen.execute({ action: "generate" }, ctx);
  assert((raw as string).includes("prompt"), "should require prompt");
});

await test("image_gen: edit without image_path", async () => {
  const raw = await imageGen.execute(
    {
      action: "edit",
      prompt: "make it blue",
    },
    ctx,
  );
  assert((raw as string).includes("image_path"), "should require image_path");
});

await test("image_gen: upscale without image_path", async () => {
  const raw = await imageGen.execute({ action: "upscale" }, ctx);
  assert((raw as string).includes("image_path"), "should require image_path");
});

await test("image_gen: remove_bg without image_path", async () => {
  const raw = await imageGen.execute({ action: "remove_bg" }, ctx);
  assert((raw as string).includes("image_path"), "should require image_path");
});

// ── Live API Tests ──

let generatedImagePath = "";

await test("image_gen: generate image", async () => {
  const raw = await imageGen.execute(
    {
      action: "generate",
      prompt: "a simple red circle on white background",
      size: "1024x1024",
      quality: "low",
      output_dir: OUTPUT_DIR,
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `expected success: ${raw}`);
  assert(typeof result.output_path === "string", "should have output_path");
  assert(
    existsSync(result.output_path),
    `file should exist: ${result.output_path}`,
  );

  const fileSize = readFileSync(result.output_path).length;
  assert(fileSize > 1000, `file too small (${fileSize} bytes), likely empty`);

  generatedImagePath = result.output_path;
  process.stdout.write(`  saved: ${result.output_path} (${fileSize} bytes)\n`);
});

await test("image_gen: edit image", async () => {
  assert(
    generatedImagePath.length > 0,
    "need generated image from previous test",
  );

  const raw = await imageGen.execute(
    {
      action: "edit",
      prompt: "change the red circle to a blue square",
      image_path: generatedImagePath,
      quality: "low",
      output_dir: OUTPUT_DIR,
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `expected success: ${raw}`);
  assert(existsSync(result.output_path), "edited file should exist");

  const fileSize = readFileSync(result.output_path).length;
  process.stdout.write(`  saved: ${result.output_path} (${fileSize} bytes)\n`);
});

await test("image_gen: upscale image", async () => {
  assert(
    generatedImagePath.length > 0,
    "need generated image from previous test",
  );

  const raw = await imageGen.execute(
    {
      action: "upscale",
      image_path: generatedImagePath,
      output_dir: OUTPUT_DIR,
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `expected success: ${raw}`);
  assert(existsSync(result.output_path), "upscaled file should exist");

  const origSize = readFileSync(generatedImagePath).length;
  const upscaledSize = readFileSync(result.output_path).length;
  process.stdout.write(
    `  original: ${origSize} bytes -> upscaled: ${upscaledSize} bytes\n`,
  );
});

await test("image_gen: remove background", async () => {
  assert(
    generatedImagePath.length > 0,
    "need generated image from previous test",
  );

  const raw = await imageGen.execute(
    {
      action: "remove_bg",
      image_path: generatedImagePath,
      output_dir: OUTPUT_DIR,
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `expected success: ${raw}`);
  assert(existsSync(result.output_path), "bg-removed file should exist");
  assert(
    result.output_path.endsWith(".png"),
    "bg-removed should be PNG (transparency)",
  );

  const fileSize = readFileSync(result.output_path).length;
  process.stdout.write(`  saved: ${result.output_path} (${fileSize} bytes)\n`);
});

await test("image_gen: nonexistent input image", async () => {
  const raw = await imageGen.execute(
    {
      action: "upscale",
      image_path: "/tmp/does-not-exist-12345.png",
      output_dir: OUTPUT_DIR,
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === false, "should fail for nonexistent image");
  assert(
    result.error.includes("not found") || result.error.includes("not exist"),
    "should mention file not found",
  );
});

// ── Cleanup (skip with --keep-output) ──

if (!process.argv.includes("--keep-output")) {
  try {
    rmSync(OUTPUT_DIR, { recursive: true, force: true });
  } catch {}
}

process.stdout.write("\n\nAll image-gen tests passed!\n");
