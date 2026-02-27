import { tool } from "@opencode-ai/plugin";
import Replicate from "replicate";
import { getEnv } from "./lib/get-env";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { resolve, basename, extname, dirname } from "path";

const GENERATE_MODEL = "black-forest-labs/flux-schnell";
const EDIT_MODEL = "black-forest-labs/flux-redux-dev";
const UPSCALE_MODEL = "recraft-ai/recraft-crisp-upscale";
const REMOVE_BG_MODEL = "bria/remove-background";

type Action = "generate" | "edit" | "upscale" | "remove_bg";

interface FileOutput {
  url(): string | URL;
  blob(): Promise<Blob>;
  [Symbol.iterator](): Iterator<Uint8Array>;
}

function ensureDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function generateFilename(
  action: Action,
  prompt?: string,
  ext = ".webp",
): string {
  const ts = Date.now();
  const label = prompt ? slugify(prompt) : action;
  return `${label}-${ts}${ext}`;
}

async function outputToBytes(
  output: unknown,
): Promise<{ bytes: Buffer; url: string }> {
  if (output && typeof output === "object" && "url" in output) {
    const fo = output as FileOutput;
    const blob = await fo.blob();
    const urlVal = fo.url();
    return {
      bytes: Buffer.from(await blob.arrayBuffer()),
      url: typeof urlVal === "string" ? urlVal : urlVal.toString(),
    };
  }

  if (Array.isArray(output) && output.length > 0) {
    return outputToBytes(output[0]);
  }

  if (typeof output === "string") {
    if (output.startsWith("data:")) {
      const b64 = output.split(",")[1] ?? "";
      return { bytes: Buffer.from(b64, "base64"), url: "" };
    }
    if (output.startsWith("http")) {
      const res = await fetch(output);
      return {
        bytes: Buffer.from(await res.arrayBuffer()),
        url: output,
      };
    }
  }

  throw new Error("Unexpected model output format");
}

function loadImageAsBase64(imagePath: string): string {
  const abs = resolve(imagePath);
  if (!existsSync(abs)) throw new Error(`Image not found: ${abs}`);
  const bytes = readFileSync(abs);
  const ext = extname(abs).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };
  const mime = mimeMap[ext] ?? "image/png";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

const SIZE_TO_ASPECT: Record<string, string> = {
  "1024x1024": "1:1",
  "1536x1024": "3:2",
  "1024x1536": "2:3",
  "1792x1024": "16:9",
  "1024x1792": "9:16",
};

const QUALITY_MAP: Record<string, number> = {
  low: 60,
  medium: 80,
  high: 95,
};

async function runGenerate(
  replicate: Replicate,
  prompt: string,
  size: string,
  quality: string,
  outputDir: string,
): Promise<{ path: string; url: string }> {
  const aspectRatio = SIZE_TO_ASPECT[size] ?? "1:1";
  const outputQuality = QUALITY_MAP[quality] ?? 80;

  const output = await replicate.run(GENERATE_MODEL, {
    input: {
      prompt,
      num_outputs: 1,
      aspect_ratio: aspectRatio,
      output_format: "webp",
      output_quality: outputQuality,
    },
  });

  const { bytes, url } = await outputToBytes(output);
  const filename = generateFilename("generate", prompt, ".webp");
  const outPath = resolve(outputDir, filename);
  ensureDir(outPath);
  writeFileSync(outPath, bytes);
  return { path: outPath, url };
}

async function runEdit(
  replicate: Replicate,
  prompt: string,
  imagePath: string,
  size: string,
  quality: string,
  outputDir: string,
): Promise<{ path: string; url: string }> {
  const aspectRatio = SIZE_TO_ASPECT[size] ?? "1:1";
  const outputQuality = QUALITY_MAP[quality] ?? 80;
  const imageDataUrl = loadImageAsBase64(imagePath);

  const output = await replicate.run(EDIT_MODEL, {
    input: {
      prompt,
      redux_image: imageDataUrl,
      num_outputs: 1,
      aspect_ratio: aspectRatio,
      output_format: "webp",
      output_quality: outputQuality,
    },
  });

  const { bytes, url } = await outputToBytes(output);
  const filename = generateFilename("edit", prompt, ".webp");
  const outPath = resolve(outputDir, filename);
  ensureDir(outPath);
  writeFileSync(outPath, bytes);
  return { path: outPath, url };
}

async function runUpscale(
  replicate: Replicate,
  imagePath: string,
  outputDir: string,
): Promise<{ path: string; url: string }> {
  const imageDataUrl = loadImageAsBase64(imagePath);

  const output = await replicate.run(UPSCALE_MODEL, {
    input: { image: imageDataUrl },
  });

  const { bytes, url } = await outputToBytes(output);
  const base = basename(imagePath, extname(imagePath));
  const filename = `${base}-upscaled-${Date.now()}.webp`;
  const outPath = resolve(outputDir, filename);
  ensureDir(outPath);
  writeFileSync(outPath, bytes);
  return { path: outPath, url };
}

async function runRemoveBg(
  replicate: Replicate,
  imagePath: string,
  outputDir: string,
): Promise<{ path: string; url: string }> {
  const imageDataUrl = loadImageAsBase64(imagePath);

  const output = await replicate.run(REMOVE_BG_MODEL, {
    input: { image: imageDataUrl },
  });

  const { bytes, url } = await outputToBytes(output);
  const base = basename(imagePath, extname(imagePath));
  const filename = `${base}-nobg-${Date.now()}.png`;
  const outPath = resolve(outputDir, filename);
  ensureDir(outPath);
  writeFileSync(outPath, bytes);
  return { path: outPath, url };
}

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);

  if (msg.includes("moderation") || msg.includes("safety"))
    return "Content was blocked by the safety filter. Try a different prompt.";
  if (msg.includes("rate") || msg.includes("429"))
    return "Rate limited. Wait a moment and try again.";
  if (msg.includes("invalid") && msg.includes("image"))
    return "The input image format is not supported. Use PNG, JPEG, or WebP.";
  if (msg.includes("timeout"))
    return "The operation timed out. Try again or use a simpler prompt.";

  return msg;
}

export default tool({
  description:
    "Generate, edit, upscale, or remove backgrounds from images using AI models via Replicate. " +
    "Actions: 'generate' (text-to-image via Flux Schnell), 'edit' (modify existing image with prompt via Flux Redux), " +
    "'upscale' (enhance resolution via Recraft Crisp Upscale), 'remove_bg' (remove background via BRIA RMBG 2.0). " +
    "Requires REPLICATE_API_TOKEN. You MUST specify output_dir to control where files are saved.",
  args: {
    action: tool.schema
      .string()
      .describe(
        "Action to perform: 'generate', 'edit', 'upscale', or 'remove_bg'",
      ),
    prompt: tool.schema
      .string()
      .optional()
      .describe(
        "Text prompt for generate/edit. Required for 'generate' and 'edit'. " +
          "Be specific and descriptive for best results.",
      ),
    image_path: tool.schema
      .string()
      .optional()
      .describe(
        "Path to input image. Required for 'edit', 'upscale', and 'remove_bg'. " +
          "Supports PNG, JPEG, WebP.",
      ),
    size: tool.schema
      .string()
      .optional()
      .describe(
        "Image size for generate/edit: '1024x1024' (1:1, default), '1536x1024' (3:2 landscape), " +
          "'1024x1536' (2:3 portrait), '1792x1024' (16:9 wide), '1024x1792' (9:16 tall)",
      ),
    quality: tool.schema
      .string()
      .optional()
      .describe("Image quality: 'low', 'medium' (default), or 'high'"),
    output_dir: tool.schema
      .string()
      .describe(
        "Output directory where the generated image will be saved. The directory will be created if it doesn't exist. Required.",
      ),
  },
  async execute(args, _context) {
    const token = getEnv("REPLICATE_API_TOKEN");
    if (!token) return "Error: REPLICATE_API_TOKEN not set.";

    const action = args.action as Action;
    if (!["generate", "edit", "upscale", "remove_bg"].includes(action))
      return `Error: Invalid action '${action}'. Use 'generate', 'edit', 'upscale', or 'remove_bg'.`;

    if ((action === "generate" || action === "edit") && !args.prompt)
      return `Error: 'prompt' is required for '${action}' action.`;

    if (
      (action === "edit" || action === "upscale" || action === "remove_bg") &&
      !args.image_path
    )
      return `Error: 'image_path' is required for '${action}' action.`;

    if (!args.output_dir)
      return "Error: 'output_dir' is required. Specify where to save the output.";

    const replicate = new Replicate({ auth: token });
    const outputDir = resolve(args.output_dir);
    const size = args.size ?? "1024x1024";
    const quality = args.quality ?? "medium";

    try {
      let result: { path: string; url: string };

      switch (action) {
        case "generate":
          result = await runGenerate(
            replicate,
            args.prompt!,
            size,
            quality,
            outputDir,
          );
          break;
        case "edit":
          result = await runEdit(
            replicate,
            args.prompt!,
            args.image_path!,
            size,
            quality,
            outputDir,
          );
          break;
        case "upscale":
          result = await runUpscale(replicate, args.image_path!, outputDir);
          break;
        case "remove_bg":
          result = await runRemoveBg(replicate, args.image_path!, outputDir);
          break;
      }

      return JSON.stringify(
        {
          success: true,
          action,
          output_path: result.path,
          replicate_url: result.url,
          ...(args.prompt && { prompt: args.prompt }),
          ...(args.image_path && { input_image: args.image_path }),
        },
        null,
        2,
      );
    } catch (e) {
      return JSON.stringify(
        {
          success: false,
          action,
          error: friendlyError(e),
        },
        null,
        2,
      );
    }
  },
});
