import { readFileSync, existsSync, rmSync } from "fs";
import { resolve } from "path";

const envPath = resolve(import.meta.dir, "../../.env");
for (const line of readFileSync(envPath, "utf-8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq > 0) process.env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
}

const OUTPUT_DIR = resolve(import.meta.dir, "test-output-video");

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

const videoGen = (await import("../video-gen.ts")).default;

const ctx = { directory: process.cwd(), worktree: process.cwd() } as Parameters<
  typeof videoGen.execute
>[1];

// ── Validation Tests (no API calls) ──

await test("video_gen: missing API key", async () => {
  const saved = process.env.REPLICATE_API_TOKEN;
  delete process.env.REPLICATE_API_TOKEN;
  const raw = await videoGen.execute({ prompt: "test" }, ctx);
  process.env.REPLICATE_API_TOKEN = saved;
  assert(
    (raw as string).includes("REPLICATE_API_TOKEN"),
    "should mention missing key",
  );
});

await test("video_gen: missing prompt", async () => {
  const raw = await videoGen.execute({} as any, ctx);
  assert((raw as string).includes("prompt"), "should require prompt");
});

await test("video_gen: nonexistent input image", async () => {
  const raw = await videoGen.execute(
    {
      prompt: "animate this",
      image_path: "/tmp/does-not-exist-99999.png",
      output_dir: OUTPUT_DIR,
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === false, "should fail");
  assert(result.error.includes("not found"), "should mention file not found");
});

// ── Live API Test: text-to-video ──

await test("video_gen: text-to-video", async () => {
  process.stdout.write("  generating video (this takes 1-3 min)...\n");
  const raw = await videoGen.execute(
    {
      prompt:
        "a slow zoom into a single red rose on a dark background, cinematic",
      duration: 5,
      aspect_ratio: "1:1",
      fps: 24,
      output_dir: OUTPUT_DIR,
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `expected success: ${raw}`);
  assert(typeof result.output_path === "string", "should have output_path");
  assert(result.output_path.endsWith(".mp4"), "should be .mp4");
  assert(
    existsSync(result.output_path),
    `file should exist: ${result.output_path}`,
  );
  assert(result.mode === "text-to-video", "should be text-to-video mode");
  assert(result.duration === 5, "duration should be 5");
  assert(
    result.file_size_bytes > 10000,
    `file too small: ${result.file_size_bytes}`,
  );

  process.stdout.write(
    `  saved: ${result.output_path} (${(result.file_size_bytes / 1024 / 1024).toFixed(1)} MB)\n`,
  );
});

// ── Cleanup (skip with --keep-output) ──

if (!process.argv.includes("--keep-output")) {
  try {
    rmSync(OUTPUT_DIR, { recursive: true, force: true });
  } catch {}
}

process.stdout.write("\n\nAll video-gen tests passed!\n");
