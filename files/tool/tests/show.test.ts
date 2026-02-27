import { rmSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";

const TEST_DIR = resolve(import.meta.dir, "test-show");

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

const show = (await import("../show.ts")).default;

const ctx = { directory: process.cwd(), worktree: process.cwd() } as Parameters<
  typeof show.execute
>[1];

// ── Validation Tests ──

await test("invalid action rejects", async () => {
  const raw = await show.execute({ action: "dance" }, ctx);
  assert(
    (raw as string).includes("Invalid action"),
    "should reject invalid action",
  );
});

await test("show without type rejects", async () => {
  const raw = await show.execute({ action: "show" }, ctx);
  assert(
    (raw as string).includes("'type' is required"),
    "should require type for show",
  );
});

await test("file type without path rejects", async () => {
  const raw = await show.execute(
    { action: "show", type: "file" },
    ctx,
  );
  assert(
    (raw as string).includes("'path' is required"),
    "should require path for file type",
  );
});

await test("image type without path rejects", async () => {
  const raw = await show.execute(
    { action: "show", type: "image" },
    ctx,
  );
  assert(
    (raw as string).includes("'path' is required"),
    "should require path for image type",
  );
});

await test("video type without path rejects", async () => {
  const raw = await show.execute(
    { action: "show", type: "video" },
    ctx,
  );
  assert(
    (raw as string).includes("'path' is required"),
    "should require path for video type",
  );
});

await test("audio type without path rejects", async () => {
  const raw = await show.execute(
    { action: "show", type: "audio" },
    ctx,
  );
  assert(
    (raw as string).includes("'path' is required"),
    "should require path for audio type",
  );
});

await test("pdf type without path rejects", async () => {
  const raw = await show.execute(
    { action: "show", type: "pdf" },
    ctx,
  );
  assert(
    (raw as string).includes("'path' is required"),
    "should require path for pdf type",
  );
});

await test("url type without url rejects", async () => {
  const raw = await show.execute(
    { action: "show", type: "url" },
    ctx,
  );
  assert(
    (raw as string).includes("'url' is required"),
    "should require url for url type",
  );
});

await test("text type without content rejects", async () => {
  const raw = await show.execute(
    { action: "show", type: "text" },
    ctx,
  );
  assert(
    (raw as string).includes("'content' is required"),
    "should require content for text type",
  );
});

await test("error type without content rejects", async () => {
  const raw = await show.execute(
    { action: "show", type: "error" },
    ctx,
  );
  assert(
    (raw as string).includes("'content' is required"),
    "should require content for error type",
  );
});

await test("code type without content rejects", async () => {
  const raw = await show.execute(
    { action: "show", type: "code" },
    ctx,
  );
  assert(
    (raw as string).includes("'content' is required"),
    "should require content for code type",
  );
});

await test("markdown type without content rejects", async () => {
  const raw = await show.execute(
    { action: "show", type: "markdown" },
    ctx,
  );
  assert(
    (raw as string).includes("'content' is required"),
    "should require content for markdown type",
  );
});

await test("html type without content rejects", async () => {
  const raw = await show.execute(
    { action: "show", type: "html" },
    ctx,
  );
  assert(
    (raw as string).includes("'content' is required"),
    "should require content for html type",
  );
});

await test("nonexistent file rejects", async () => {
  const raw = await show.execute(
    {
      action: "show",
      type: "file",
      path: "/tmp/does-not-exist-show-test-12345.txt",
    },
    ctx,
  );
  assert(
    (raw as string).includes("File not found"),
    "should reject nonexistent file",
  );
});

await test("invalid metadata JSON rejects", async () => {
  mkdirSync(TEST_DIR, { recursive: true });
  const tmpFile = resolve(TEST_DIR, "temp.txt");
  writeFileSync(tmpFile, "test");

  const raw = await show.execute(
    {
      action: "show",
      type: "file",
      path: tmpFile,
      metadata: "not valid json{{{",
    },
    ctx,
  );
  assert(
    (raw as string).includes("Invalid JSON"),
    "should reject invalid metadata JSON",
  );
});

await test("invalid variant rejects", async () => {
  const raw = await show.execute(
    { action: "show", type: "text", content: "hello", variant: "huge" },
    ctx,
  );
  assert(
    (raw as string).includes("Invalid variant"),
    "should reject invalid variant",
  );
});

await test("invalid aspect_ratio rejects", async () => {
  const raw = await show.execute(
    { action: "show", type: "text", content: "hello", aspect_ratio: "99:99" },
    ctx,
  );
  assert(
    (raw as string).includes("Invalid aspect_ratio"),
    "should reject invalid aspect_ratio",
  );
});

await test("invalid theme rejects", async () => {
  const raw = await show.execute(
    { action: "show", type: "text", content: "hello", theme: "rainbow" },
    ctx,
  );
  assert(
    (raw as string).includes("Invalid theme"),
    "should reject invalid theme",
  );
});

// ── Functional Tests ──

await test("show url returns structured entry with default variant", async () => {
  const raw = await show.execute(
    {
      action: "show",
      type: "url",
      title: "Test Report",
      description: "A test URL",
      url: "https://example.com/report",
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `expected success: ${raw}`);
  assert(result.entry.type === "url", "entry type should be url");
  assert(result.entry.url === "https://example.com/report", "url should match");
  assert(result.entry.title === "Test Report", "title should match");
  assert(result.entry.variant === "full", "url default variant should be 'full'");
  assert(typeof result.entry.id === "string", "should have an id");
  assert(typeof result.entry.timestamp === "string", "should have a timestamp");
});

await test("show text returns structured entry with detail variant", async () => {
  const raw = await show.execute(
    {
      action: "show",
      type: "text",
      title: "Summary",
      content: "# Hello World\n\nThis is a **test** summary.",
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `expected success: ${raw}`);
  assert(result.entry.type === "text", "entry type should be text");
  assert(result.entry.variant === "detail", "text default variant should be 'detail'");
  assert(
    result.entry.content.includes("Hello World"),
    "content should be preserved",
  );
});

await test("show file returns structured entry with resolved path", async () => {
  mkdirSync(TEST_DIR, { recursive: true });
  const tmpFile = resolve(TEST_DIR, "output.txt");
  writeFileSync(tmpFile, "file content here");

  const raw = await show.execute(
    {
      action: "show",
      type: "file",
      title: "Output File",
      path: tmpFile,
      metadata: '{"format":"txt","size":17}',
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `expected success: ${raw}`);
  assert(result.entry.type === "file", "entry type should be file");
  assert(result.entry.path === tmpFile, "path should be resolved");
  assert(result.entry.metadata?.format === "txt", "metadata should be parsed");
  assert(result.entry.variant === "compact", "file default variant should be 'compact'");
});

await test("show image returns structured entry with gallery variant", async () => {
  mkdirSync(TEST_DIR, { recursive: true });
  const tmpFile = resolve(TEST_DIR, "photo.png");
  writeFileSync(tmpFile, "fake-png-bytes");

  const raw = await show.execute(
    {
      action: "show",
      type: "image",
      title: "Screenshot",
      path: tmpFile,
      aspect_ratio: "16:9",
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `expected success: ${raw}`);
  assert(result.entry.type === "image", "entry type should be image");
  assert(result.entry.path === tmpFile, "path should match");
  assert(result.entry.variant === "gallery", "image default variant should be 'gallery'");
  assert(result.entry.aspect_ratio === "16:9", "aspect_ratio should be preserved");
});

await test("show error returns structured entry", async () => {
  const raw = await show.execute(
    {
      action: "show",
      type: "error",
      title: "Generation Failed",
      content: "The image generation API returned a 500 error.",
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `expected success: ${raw}`);
  assert(result.entry.type === "error", "entry type should be error");
  assert(result.entry.variant === "compact", "error default variant should be 'compact'");
});

await test("show code returns structured entry with language", async () => {
  const raw = await show.execute(
    {
      action: "show",
      type: "code",
      title: "API Response",
      content: 'const x = 42;\nconsole.log(x);',
      language: "typescript",
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `expected success: ${raw}`);
  assert(result.entry.type === "code", "entry type should be code");
  assert(result.entry.language === "typescript", "language should be preserved");
  assert(result.entry.variant === "detail", "code default variant should be 'detail'");
});

await test("show markdown returns structured entry", async () => {
  const raw = await show.execute(
    {
      action: "show",
      type: "markdown",
      title: "Report",
      content: "# Heading\n\n- item 1\n- item 2",
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `expected success: ${raw}`);
  assert(result.entry.type === "markdown", "entry type should be markdown");
  assert(result.entry.variant === "detail", "markdown default variant should be 'detail'");
});

await test("show html returns structured entry", async () => {
  const raw = await show.execute(
    {
      action: "show",
      type: "html",
      title: "Widget",
      content: "<h1>Hello</h1><p>World</p>",
      aspect_ratio: "4:3",
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `expected success: ${raw}`);
  assert(result.entry.type === "html", "entry type should be html");
  assert(result.entry.aspect_ratio === "4:3", "aspect_ratio should be preserved");
});

await test("show video returns structured entry with gallery variant", async () => {
  mkdirSync(TEST_DIR, { recursive: true });
  const tmpFile = resolve(TEST_DIR, "clip.mp4");
  writeFileSync(tmpFile, "fake-mp4-bytes");

  const raw = await show.execute(
    {
      action: "show",
      type: "video",
      title: "Demo Video",
      path: tmpFile,
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `expected success: ${raw}`);
  assert(result.entry.type === "video", "entry type should be video");
  assert(result.entry.variant === "gallery", "video default variant should be 'gallery'");
});

await test("show audio returns structured entry with compact variant", async () => {
  mkdirSync(TEST_DIR, { recursive: true });
  const tmpFile = resolve(TEST_DIR, "song.mp3");
  writeFileSync(tmpFile, "fake-mp3-bytes");

  const raw = await show.execute(
    {
      action: "show",
      type: "audio",
      title: "Voice Memo",
      path: tmpFile,
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `expected success: ${raw}`);
  assert(result.entry.type === "audio", "entry type should be audio");
  assert(result.entry.variant === "compact", "audio default variant should be 'compact'");
});

await test("explicit variant overrides default", async () => {
  const raw = await show.execute(
    {
      action: "show",
      type: "text",
      content: "hello",
      variant: "compact",
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.entry.variant === "compact", "explicit variant should override default");
});

await test("theme is included in entry when not default", async () => {
  const raw = await show.execute(
    {
      action: "show",
      type: "text",
      content: "success!",
      theme: "success",
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.entry.theme === "success", "theme should be in entry");
});

await test("default theme is omitted from entry", async () => {
  const raw = await show.execute(
    {
      action: "show",
      type: "text",
      content: "hello",
      theme: "default",
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.entry.theme === undefined, "default theme should not be in entry");
});

await test("show pdf returns structured entry", async () => {
  mkdirSync(TEST_DIR, { recursive: true });
  const tmpFile = resolve(TEST_DIR, "doc.pdf");
  writeFileSync(tmpFile, "fake-pdf-bytes");

  const raw = await show.execute(
    {
      action: "show",
      type: "pdf",
      title: "Research Paper",
      path: tmpFile,
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `expected success: ${raw}`);
  assert(result.entry.type === "pdf", "entry type should be pdf");
  assert(result.entry.variant === "full", "pdf default variant should be 'full'");
});

// ── New path-based types: csv, xlsx, docx, pptx ──

await test("csv type without path rejects", async () => {
  const raw = await show.execute(
    { action: "show", type: "csv" },
    ctx,
  );
  assert(
    (raw as string).includes("'path' is required"),
    "should require path for csv type",
  );
});

await test("xlsx type without path rejects", async () => {
  const raw = await show.execute(
    { action: "show", type: "xlsx" },
    ctx,
  );
  assert(
    (raw as string).includes("'path' is required"),
    "should require path for xlsx type",
  );
});

await test("docx type without path rejects", async () => {
  const raw = await show.execute(
    { action: "show", type: "docx" },
    ctx,
  );
  assert(
    (raw as string).includes("'path' is required"),
    "should require path for docx type",
  );
});

await test("pptx type without path rejects", async () => {
  const raw = await show.execute(
    { action: "show", type: "pptx" },
    ctx,
  );
  assert(
    (raw as string).includes("'path' is required"),
    "should require path for pptx type",
  );
});

await test("show csv returns structured entry with full variant", async () => {
  mkdirSync(TEST_DIR, { recursive: true });
  const tmpFile = resolve(TEST_DIR, "data.csv");
  writeFileSync(tmpFile, "name,age\nAlice,30\nBob,25");

  const raw = await show.execute(
    {
      action: "show",
      type: "csv",
      title: "User Data",
      path: tmpFile,
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `expected success: ${raw}`);
  assert(result.entry.type === "csv", "entry type should be csv");
  assert(result.entry.variant === "full", "csv default variant should be 'full'");
});

await test("show xlsx returns structured entry with full variant", async () => {
  mkdirSync(TEST_DIR, { recursive: true });
  const tmpFile = resolve(TEST_DIR, "spreadsheet.xlsx");
  writeFileSync(tmpFile, "fake-xlsx-bytes");

  const raw = await show.execute(
    {
      action: "show",
      type: "xlsx",
      title: "Sales Report",
      path: tmpFile,
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `expected success: ${raw}`);
  assert(result.entry.type === "xlsx", "entry type should be xlsx");
  assert(result.entry.variant === "full", "xlsx default variant should be 'full'");
});

await test("show docx returns structured entry with full variant", async () => {
  mkdirSync(TEST_DIR, { recursive: true });
  const tmpFile = resolve(TEST_DIR, "document.docx");
  writeFileSync(tmpFile, "fake-docx-bytes");

  const raw = await show.execute(
    {
      action: "show",
      type: "docx",
      title: "Research Paper",
      path: tmpFile,
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `expected success: ${raw}`);
  assert(result.entry.type === "docx", "entry type should be docx");
  assert(result.entry.variant === "full", "docx default variant should be 'full'");
});

await test("show pptx returns structured entry with full variant", async () => {
  mkdirSync(TEST_DIR, { recursive: true });
  const tmpFile = resolve(TEST_DIR, "presentation.pptx");
  writeFileSync(tmpFile, "fake-pptx-bytes");

  const raw = await show.execute(
    {
      action: "show",
      type: "pptx",
      title: "Quarterly Review",
      path: tmpFile,
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `expected success: ${raw}`);
  assert(result.entry.type === "pptx", "entry type should be pptx");
  assert(result.entry.variant === "full", "pptx default variant should be 'full'");
});

// ── Multi-item (carousel) tests ──

await test("items with valid array returns entries", async () => {
  mkdirSync(TEST_DIR, { recursive: true });
  const img1 = resolve(TEST_DIR, "carousel1.png");
  const img2 = resolve(TEST_DIR, "carousel2.png");
  writeFileSync(img1, "fake-png");
  writeFileSync(img2, "fake-png");

  const raw = await show.execute(
    {
      action: "show",
      title: "Logo Variations",
      items: JSON.stringify([
        { type: "image", title: "Version A", path: img1 },
        { type: "image", title: "Version B", path: img2 },
      ]),
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `expected success: ${raw}`);
  assert(Array.isArray(result.items), "should have items array");
  assert(result.items.length === 2, `expected 2 items, got ${result.items.length}`);
  assert(result.items[0].type === "image", "first item type should be image");
  assert(result.items[0].title === "Version A", "first item title should match");
  assert(result.items[1].title === "Version B", "second item title should match");
  assert(result.title === "Logo Variations", "top-level title should pass through");
  assert(!result.entry, "should not have single entry when items is present");
});

await test("items with mixed types works", async () => {
  mkdirSync(TEST_DIR, { recursive: true });
  const tmpFile = resolve(TEST_DIR, "carousel-mixed.png");
  writeFileSync(tmpFile, "fake-png");

  const raw = await show.execute(
    {
      action: "show",
      items: JSON.stringify([
        { type: "image", title: "Screenshot", path: tmpFile },
        { type: "url", title: "Live Demo", url: "https://example.com" },
        { type: "text", title: "Notes", content: "Some notes here" },
      ]),
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `expected success: ${raw}`);
  assert(result.items.length === 3, "should have 3 items");
  assert(result.items[0].type === "image", "first type");
  assert(result.items[1].type === "url", "second type");
  assert(result.items[2].type === "text", "third type");
});

await test("items with invalid JSON rejects", async () => {
  const raw = await show.execute(
    { action: "show", items: "not valid json[[[" },
    ctx,
  );
  assert(
    (raw as string).includes("Invalid JSON"),
    "should reject invalid JSON in items",
  );
});

await test("items with empty array rejects", async () => {
  const raw = await show.execute(
    { action: "show", items: "[]" },
    ctx,
  );
  assert(
    (raw as string).includes("non-empty"),
    "should reject empty items array",
  );
});

await test("items with all invalid items returns error", async () => {
  const raw = await show.execute(
    {
      action: "show",
      items: JSON.stringify([
        { type: "file" }, // missing path
        { type: "url" },  // missing url
      ]),
    },
    ctx,
  );
  assert(
    (raw as string).includes("All items failed"),
    "should error when all items fail validation",
  );
});

await test("items with partial failures returns valid ones + warnings", async () => {
  mkdirSync(TEST_DIR, { recursive: true });
  const tmpFile = resolve(TEST_DIR, "carousel-partial.png");
  writeFileSync(tmpFile, "fake-png");

  const raw = await show.execute(
    {
      action: "show",
      items: JSON.stringify([
        { type: "image", title: "Good", path: tmpFile },
        { type: "file" }, // missing path — will fail
      ]),
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, "should succeed with partial results");
  assert(result.items.length === 1, "should have 1 valid item");
  assert(result.items[0].title === "Good", "valid item should be included");
  assert(Array.isArray(result.warnings), "should have warnings array");
  assert(result.warnings.length === 1, "should have 1 warning");
});

await test("items preserves top-level theme and description", async () => {
  const raw = await show.execute(
    {
      action: "show",
      title: "Results",
      description: "Here are the outputs",
      theme: "success",
      items: JSON.stringify([
        { type: "text", title: "A", content: "hello" },
        { type: "text", title: "B", content: "world" },
      ]),
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `expected success: ${raw}`);
  assert(result.title === "Results", "top-level title");
  assert(result.description === "Here are the outputs", "top-level description");
  assert(result.theme === "success", "top-level theme");
});

await test("items ignores type param when items is provided", async () => {
  const raw = await show.execute(
    {
      action: "show",
      type: "text",
      content: "ignored",
      items: JSON.stringify([
        { type: "text", title: "Used", content: "this one" },
      ]),
    },
    ctx,
  );
  const result = JSON.parse(raw as string);
  assert(result.success === true, `expected success: ${raw}`);
  assert(Array.isArray(result.items), "should use items mode");
  assert(result.items.length === 1, "should have 1 item from array");
  assert(!result.entry, "should not have single entry");
});

// ── Cleanup ──

if (!process.argv.includes("--keep-output")) {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {}
}

process.stdout.write("\n\nAll show tests passed!\n");
