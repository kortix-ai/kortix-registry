import { tool } from "@opencode-ai/plugin";
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  rmSync,
  unlinkSync,
  statSync,
} from "fs";
import { resolve, join, dirname } from "path";
import { execSync } from "child_process";

const PRESENTATIONS_DIR = "presentations";

type Action =
  | "create_slide"
  | "list_slides"
  | "delete_slide"
  | "list_presentations"
  | "delete_presentation"
  | "validate_slide"
  | "export_pdf"
  | "export_pptx"
  | "preview";

const SCRIPTS_DIR = resolve(
  dirname(new URL(import.meta.url).pathname),
  "scripts",
);

const SKILLS_DIR = resolve(
  dirname(new URL(import.meta.url).pathname),
  "..",
  "skills",
  "presentations",
);

interface SlideMetadata {
  title: string;
  filename: string;
  file_path: string;
  created_at: string;
}

interface PresentationMetadata {
  presentation_name: string;
  title: string;
  description: string;
  slides: Record<string, SlideMetadata>;
  created_at: string;
  updated_at: string;
}

function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 80);
}

function ensurePresentationsDir(base: string): string {
  const dir = resolve(base, PRESENTATIONS_DIR);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "EACCES" || code === "EROFS") {
      const fallback = resolve(process.cwd(), PRESENTATIONS_DIR);
      mkdirSync(fallback, { recursive: true });
      return fallback;
    }
    throw err;
  }
  return dir;
}

function ensurePresentationDir(
  base: string,
  name: string,
): { safeName: string; path: string; presDir: string } {
  const safeName = sanitizeFilename(name);
  const presDir = ensurePresentationsDir(base);
  const path = join(presDir, safeName);
  mkdirSync(path, { recursive: true });
  return { safeName, path, presDir };
}

function loadMetadata(presentationPath: string): PresentationMetadata {
  const metaPath = join(presentationPath, "metadata.json");
  if (existsSync(metaPath)) {
    return JSON.parse(readFileSync(metaPath, "utf-8"));
  }
  return {
    presentation_name: "",
    title: "Presentation",
    description: "",
    slides: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function saveMetadata(
  presentationPath: string,
  metadata: PresentationMetadata,
): void {
  metadata.updated_at = new Date().toISOString();
  writeFileSync(
    join(presentationPath, "metadata.json"),
    JSON.stringify(metadata, null, 2),
  );
}

function createSlideHtml(
  content: string,
  slideNumber: number,
  presentationTitle: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=1920, initial-scale=1.0">
    <title>${presentationTitle} - Slide ${slideNumber}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
    <script src="https://d3js.org/d3.v7.min.js" async></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@3.9.1" async></script>
    <style>
        * {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        }
        body {
            height: 1080px;
            width: 1920px;
            margin: 0;
            padding: 0;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        }
    </style>
</head>
<body>
    ${content}
</body>
</html>`;
}

function doCreateSlide(
  base: string,
  presentationName: string,
  slideNumber: number,
  slideTitle: string,
  content: string,
  presentationTitle: string,
): string {
  if (!presentationName)
    return JSON.stringify({
      success: false,
      error: "presentation_name is required",
    });
  if (!slideNumber || slideNumber < 1)
    return JSON.stringify({
      success: false,
      error: "slide_number must be >= 1",
    });
  if (!slideTitle)
    return JSON.stringify({ success: false, error: "slide_title is required" });
  if (!content)
    return JSON.stringify({ success: false, error: "content is required" });

  const { safeName, path: presPath, presDir } = ensurePresentationDir(
    base,
    presentationName,
  );

  mkdirSync(join(presDir, "images"), {
    recursive: true,
  });

  const metadata = loadMetadata(presPath);
  metadata.presentation_name = presentationName;
  if (presentationTitle !== "Presentation") {
    metadata.title = presentationTitle;
  }

  const html = createSlideHtml(content, slideNumber, presentationTitle);
  const filename = `slide_${String(slideNumber).padStart(2, "0")}.html`;
  writeFileSync(join(presPath, filename), html);

  const relPath = `${PRESENTATIONS_DIR}/${safeName}/${filename}`;
  metadata.slides[String(slideNumber)] = {
    title: slideTitle,
    filename,
    file_path: relPath,
    created_at: new Date().toISOString(),
  };
  saveMetadata(presPath, metadata);
  generateViewer(presPath, metadata);

  return JSON.stringify(
    {
      success: true,
      action: "create_slide",
      presentation_name: presentationName,
      presentation_path: `${PRESENTATIONS_DIR}/${safeName}`,
      slide_number: slideNumber,
      slide_title: slideTitle,
      slide_file: relPath,
      total_slides: Object.keys(metadata.slides).length,
    },
    null,
    2,
  );
}

function doListSlides(base: string, presentationName: string): string {
  if (!presentationName)
    return JSON.stringify({
      success: false,
      error: "presentation_name is required",
    });

  const safeName = sanitizeFilename(presentationName);
  const presPath = join(resolve(base, PRESENTATIONS_DIR), safeName);

  if (!existsSync(presPath)) {
    return JSON.stringify({
      success: true,
      presentation_name: presentationName,
      slides: [],
      total_slides: 0,
    });
  }

  const metadata = loadMetadata(presPath);
  const slides = Object.entries(metadata.slides)
    .map(([num, data]) => ({ slide_number: parseInt(num), ...data }))
    .sort((a, b) => a.slide_number - b.slide_number);

  return JSON.stringify(
    {
      success: true,
      presentation_name: presentationName,
      presentation_title: metadata.title,
      slides,
      total_slides: slides.length,
      presentation_path: `${PRESENTATIONS_DIR}/${safeName}`,
    },
    null,
    2,
  );
}

function doDeleteSlide(
  base: string,
  presentationName: string,
  slideNumber: number,
): string {
  if (!presentationName)
    return JSON.stringify({
      success: false,
      error: "presentation_name is required",
    });
  if (!slideNumber || slideNumber < 1)
    return JSON.stringify({
      success: false,
      error: "slide_number must be >= 1",
    });

  const safeName = sanitizeFilename(presentationName);
  const presPath = join(resolve(base, PRESENTATIONS_DIR), safeName);

  if (!existsSync(presPath)) {
    return JSON.stringify({
      success: false,
      error: `Presentation '${presentationName}' not found`,
    });
  }

  const metadata = loadMetadata(presPath);
  const key = String(slideNumber);
  if (!metadata.slides[key]) {
    return JSON.stringify({
      success: false,
      error: `Slide ${slideNumber} not found`,
    });
  }

  const slideInfo = metadata.slides[key];
  const slidePath = join(presPath, slideInfo.filename);
  try {
    unlinkSync(slidePath);
  } catch {}

  delete metadata.slides[key];
  saveMetadata(presPath, metadata);
  generateViewer(presPath, metadata);

  return JSON.stringify(
    {
      success: true,
      action: "delete_slide",
      presentation_name: presentationName,
      deleted_slide: slideNumber,
      deleted_title: slideInfo.title,
      remaining_slides: Object.keys(metadata.slides).length,
    },
    null,
    2,
  );
}

function doListPresentations(base: string): string {
  const presDir = resolve(base, PRESENTATIONS_DIR);
  if (!existsSync(presDir)) {
    return JSON.stringify({ success: true, presentations: [], total_count: 0 });
  }

  const presentations = readdirSync(presDir, { withFileTypes: true })
    .filter(
      (d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "images",
    )
    .map((d) => {
      const path = join(presDir, d.name);
      const metadata = loadMetadata(path);
      return {
        folder: d.name,
        title: metadata.title || d.name,
        description: metadata.description || "",
        total_slides: Object.keys(metadata.slides).length,
        created_at: metadata.created_at,
        updated_at: metadata.updated_at,
      };
    });

  return JSON.stringify(
    {
      success: true,
      presentations,
      total_count: presentations.length,
    },
    null,
    2,
  );
}

function doDeletePresentation(base: string, presentationName: string): string {
  if (!presentationName)
    return JSON.stringify({
      success: false,
      error: "presentation_name is required",
    });

  const safeName = sanitizeFilename(presentationName);
  const presPath = join(resolve(base, PRESENTATIONS_DIR), safeName);

  if (!existsSync(presPath)) {
    return JSON.stringify({
      success: false,
      error: `Presentation '${presentationName}' not found`,
    });
  }

  rmSync(presPath, { recursive: true, force: true });

  return JSON.stringify(
    {
      success: true,
      action: "delete_presentation",
      presentation_name: presentationName,
      deleted_path: `${PRESENTATIONS_DIR}/${safeName}`,
    },
    null,
    2,
  );
}

function generateViewer(presPath: string, metadata: PresentationMetadata): void {
  const viewerTemplatePath = join(SKILLS_DIR, "viewer.html");
  if (!existsSync(viewerTemplatePath)) return;

  const slides = Object.entries(metadata.slides)
    .map(([num, data]) => ({
      number: parseInt(num),
      title: data.title || `Slide ${num}`,
      filename: data.filename || `slide_${String(num).padStart(2, "0")}.html`,
    }))
    .sort((a, b) => a.number - b.number);

  const presData = JSON.stringify({
    title: metadata.title || metadata.presentation_name || "Presentation",
    slides,
  });

  const template = readFileSync(viewerTemplatePath, "utf-8");
  const html = template
    .replace("{{TITLE}}", metadata.title || "Presentation")
    .replace("{{PRESENTATION_DATA}}", presData);

  writeFileSync(join(presPath, "viewer.html"), html);
}

function doPreview(base: string, presentationName: string): string {
  if (!presentationName)
    return JSON.stringify({
      success: false,
      error: "presentation_name is required",
    });

  const safeName = sanitizeFilename(presentationName);
  const presPath = join(resolve(base, PRESENTATIONS_DIR), safeName);

  if (!existsSync(presPath))
    return JSON.stringify({
      success: false,
      error: `Presentation '${presentationName}' not found`,
    });

  const metadata = loadMetadata(presPath);
  generateViewer(presPath, metadata);

  const serverScript = join(SKILLS_DIR, "serve.ts");
  if (!existsSync(serverScript))
    return JSON.stringify({
      success: false,
      error: "Viewer server script not found. Check .opencode/skills/presentations/serve.ts",
    });

  try {
    execSync(`bun run "${serverScript}" "${presPath}" &`, {
      cwd: base,
      timeout: 5000,
      stdio: "ignore",
      detached: true,
    });
  } catch {
    /* the detached process continues running, the timeout is expected */
  }

  return JSON.stringify(
    {
      success: true,
      action: "preview",
      presentation_name: presentationName,
      viewer_url: "http://localhost:3210",
      viewer_file: `${PRESENTATIONS_DIR}/${safeName}/viewer.html`,
      message: "Preview server started at http://localhost:3210 — browser should open automatically. Press Ctrl+C in terminal to stop.",
    },
    null,
    2,
  );
}

function runPythonScript(
  script: string,
  args: string[],
  timeoutMs = 300_000,
): string {
  const isLinux = process.platform === "linux";
  // On Linux (sandbox), Python deps are pre-installed system-wide via Docker,
  // so run scripts directly with python3. On macOS, use uv to manage the venv.
  const cmd = isLinux
    ? `python3 ${script} ${args.map((a) => `"${a}"`).join(" ")}`
    : `uv run ${script} ${args.map((a) => `"${a}"`).join(" ")}`;

  const env: Record<string, string | undefined> = { ...process.env };
  if (!isLinux) {
    // Ensure uv has a writable cache directory
    env.UV_CACHE_DIR = env.UV_CACHE_DIR ?? join(process.env.HOME ?? "/tmp", ".cache", "uv");
  }

  try {
    const output = execSync(cmd, {
      cwd: SCRIPTS_DIR,
      timeout: timeoutMs,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });
    return output.trim();
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const stdout = err.stdout?.trim() ?? "";
    if (stdout) {
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.success === false) return stdout;
      } catch {}
    }
    return JSON.stringify({
      success: false,
      error: err.stderr?.trim() || err.message || "Python script failed",
    });
  }
}

function doValidateSlide(
  base: string,
  presentationName: string,
  slideNumber: number,
): string {
  if (!presentationName)
    return JSON.stringify({
      success: false,
      error: "presentation_name is required",
    });
  if (!slideNumber || slideNumber < 1)
    return JSON.stringify({
      success: false,
      error: "slide_number must be >= 1",
    });

  const safeName = sanitizeFilename(presentationName);
  const presPath = join(resolve(base, PRESENTATIONS_DIR), safeName);
  const metadata = loadMetadata(presPath);
  const key = String(slideNumber);
  if (!metadata.slides[key])
    return JSON.stringify({
      success: false,
      error: `Slide ${slideNumber} not found`,
    });

  const slidePath = join(resolve(base), metadata.slides[key].file_path);
  if (!existsSync(slidePath))
    return JSON.stringify({
      success: false,
      error: `Slide file not found: ${slidePath}`,
    });

  const raw = runPythonScript("validate_slide.py", [slidePath]);
  try {
    const result = JSON.parse(raw);
    return JSON.stringify(
      {
        ...result,
        action: "validate_slide",
        presentation_name: presentationName,
        slide_number: slideNumber,
      },
      null,
      2,
    );
  } catch {
    return JSON.stringify({ success: false, error: raw });
  }
}

function doExportPdf(base: string, presentationName: string): string {
  if (!presentationName)
    return JSON.stringify({
      success: false,
      error: "presentation_name is required",
    });

  const safeName = sanitizeFilename(presentationName);
  const presPath = join(resolve(base, PRESENTATIONS_DIR), safeName);
  if (!existsSync(presPath))
    return JSON.stringify({
      success: false,
      error: `Presentation '${presentationName}' not found`,
    });

  const outPath = join(presPath, `${safeName}.pdf`);
  const raw = runPythonScript("convert_pdf.py", [presPath, outPath]);
  try {
    const result = JSON.parse(raw);
    if (result.success) {
      return JSON.stringify(
        {
          ...result,
          action: "export_pdf",
          presentation_name: presentationName,
          relative_path: `${PRESENTATIONS_DIR}/${safeName}/${safeName}.pdf`,
        },
        null,
        2,
      );
    }
    return raw;
  } catch {
    return JSON.stringify({ success: false, error: raw });
  }
}

function doExportPptx(base: string, presentationName: string): string {
  if (!presentationName)
    return JSON.stringify({
      success: false,
      error: "presentation_name is required",
    });

  const safeName = sanitizeFilename(presentationName);
  const presPath = join(resolve(base, PRESENTATIONS_DIR), safeName);
  if (!existsSync(presPath))
    return JSON.stringify({
      success: false,
      error: `Presentation '${presentationName}' not found`,
    });

  const outPath = join(presPath, `${safeName}.pptx`);
  const raw = runPythonScript("convert_pptx.py", [presPath, outPath]);
  try {
    const result = JSON.parse(raw);
    if (result.success) {
      return JSON.stringify(
        {
          ...result,
          action: "export_pptx",
          presentation_name: presentationName,
          relative_path: `${PRESENTATIONS_DIR}/${safeName}/${safeName}.pptx`,
        },
        null,
        2,
      );
    }
    return raw;
  } catch {
    return JSON.stringify({ success: false, error: raw });
  }
}

export default tool({
  description:
    "Create, manage, validate, preview, and export HTML presentation slides (1920x1080). " +
    "Actions: 'create_slide', 'list_slides', 'delete_slide', 'list_presentations', 'delete_presentation', " +
    "'validate_slide' (check dimensions via Playwright), 'export_pdf' (render to PDF via Playwright), " +
    "'export_pptx' (3-layer PPTX with editable text via Playwright + python-pptx), " +
    "'preview' (starts local HTTP server with polished slide viewer at http://localhost:3210). " +
    "Each slide is a standalone HTML file with Inter font, D3.js, and Chart.js pre-loaded. " +
    "Images go to presentations/images/ and are referenced as ../images/filename from slides. " +
    "A viewer.html is auto-generated in each presentation folder on every create/delete.",
  args: {
    action: tool.schema
      .string()
      .describe(
        "Action: 'create_slide', 'list_slides', 'delete_slide', 'list_presentations', 'delete_presentation', 'validate_slide', 'export_pdf', 'export_pptx', 'preview'",
      ),
    presentation_name: tool.schema
      .string()
      .optional()
      .describe(
        "Name of the presentation folder. Required for all actions except 'list_presentations'.",
      ),
    slide_number: tool.schema
      .number()
      .optional()
      .describe(
        "Slide number (1-based). Required for 'create_slide', 'delete_slide', and 'validate_slide'.",
      ),
    slide_title: tool.schema
      .string()
      .optional()
      .describe("Title of this slide. Required for 'create_slide'."),
    content: tool.schema
      .string()
      .optional()
      .describe(
        "HTML body content for the slide (no DOCTYPE/html/head/body tags — added automatically). " +
          "Design for 1920x1080. Use box-sizing: border-box. Max 40px padding. " +
          "Inter font is pre-loaded. Use emoji for icons. Required for 'create_slide'.",
      ),
    presentation_title: tool.schema
      .string()
      .optional()
      .describe("Main title of the presentation. Defaults to 'Presentation'."),
    output_dir: tool.schema
      .string()
      .optional()
      .describe(
        "Base directory for presentations/ folder. Defaults to the current working directory. " +
          "Usually not needed — only set if you want presentations in a specific location.",
      ),
  },
  async execute(args, _context) {
    const action = args.action as Action;
    const validActions: Action[] = [
      "create_slide",
      "list_slides",
      "delete_slide",
      "list_presentations",
      "delete_presentation",
      "validate_slide",
      "export_pdf",
      "export_pptx",
      "preview",
    ];

    if (!validActions.includes(action)) {
      return `Error: Invalid action '${action}'. Use: ${validActions.join(", ")}`;
    }

    const worktree =
      _context.worktree && _context.worktree !== "/" ? _context.worktree : null;
    const base =
      args.output_dir ?? worktree ?? _context.directory ?? process.cwd();

    switch (action) {
      case "create_slide":
        return doCreateSlide(
          base,
          args.presentation_name ?? "",
          args.slide_number ?? 0,
          args.slide_title ?? "",
          args.content ?? "",
          args.presentation_title ?? "Presentation",
        );
      case "list_slides":
        return doListSlides(base, args.presentation_name ?? "");
      case "delete_slide":
        return doDeleteSlide(
          base,
          args.presentation_name ?? "",
          args.slide_number ?? 0,
        );
      case "list_presentations":
        return doListPresentations(base);
      case "delete_presentation":
        return doDeletePresentation(base, args.presentation_name ?? "");
      case "validate_slide":
        return doValidateSlide(
          base,
          args.presentation_name ?? "",
          args.slide_number ?? 0,
        );
      case "export_pdf":
        return doExportPdf(base, args.presentation_name ?? "");
      case "export_pptx":
        return doExportPptx(base, args.presentation_name ?? "");
      case "preview":
        return doPreview(base, args.presentation_name ?? "");
    }
  },
});
