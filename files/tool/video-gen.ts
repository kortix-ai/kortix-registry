import { tool } from "@opencode-ai/plugin";
import Replicate from "replicate";
import { getEnv } from "./lib/get-env";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { resolve, extname, dirname } from "path";

const VIDEO_MODEL = "bytedance/seedance-1.5-pro";

interface FileOutput {
  url(): string | URL;
  blob(): Promise<Blob>;
}

function ensureDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
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
  };
  const mime = mimeMap[ext] ?? "image/png";
  return `data:${mime};base64,${bytes.toString("base64")}`;
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

  if (output && typeof output === "object" && "read" in output) {
    const readable = output as { read(): Uint8Array };
    return { bytes: Buffer.from(readable.read()), url: "" };
  }

  if (typeof output === "string" && output.startsWith("http")) {
    const res = await fetch(output, { signal: AbortSignal.timeout(120_000) });
    return { bytes: Buffer.from(await res.arrayBuffer()), url: output };
  }

  throw new Error("Unexpected model output format");
}

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("moderation") || msg.includes("safety"))
    return "Content was blocked by the safety filter. Try a different prompt.";
  if (msg.includes("429") || msg.includes("Too Many Requests"))
    return "Rate limited (429). Wait a moment and try again.";
  if (msg.includes("timeout"))
    return "The operation timed out. Video generation can take 1-3 minutes — try again.";
  if (msg.includes("invalid") && msg.includes("image"))
    return "The input image format is not supported. Use PNG, JPEG, or WebP.";
  return msg;
}

export default tool({
  description:
    "Generate videos from text prompts or images using ByteDance Seedance 1.5 Pro via Replicate. " +
    "Supports text-to-video and image-to-video. " +
    "Options: duration (2-12s), aspect ratio, fps, camera fixed mode, audio generation. " +
    "Requires REPLICATE_API_TOKEN. You MUST specify output_dir to control where files are saved.",
  args: {
    prompt: tool.schema
      .string()
      .describe(
        "Text prompt describing the video. Be specific about motion, camera angle, and scene.",
      ),
    image_path: tool.schema
      .string()
      .optional()
      .describe(
        "Path to input image for image-to-video. When provided, the video animates from this image. " +
          "Supports PNG, JPEG, WebP.",
      ),
    duration: tool.schema
      .number()
      .optional()
      .describe("Video duration in seconds (5 or 10). Default: 5"),
    aspect_ratio: tool.schema
      .string()
      .optional()
      .describe("Aspect ratio: '16:9' (default), '9:16', '1:1', '4:3', '3:4'"),
    fps: tool.schema
      .number()
      .optional()
      .describe("Frames per second. Default: 24"),
    camera_fixed: tool.schema
      .boolean()
      .optional()
      .describe("Lock camera in place (no camera motion). Default: false"),
    generate_audio: tool.schema
      .boolean()
      .optional()
      .describe("Generate audio track for the video. Default: false"),
    seed: tool.schema
      .number()
      .optional()
      .describe("Random seed for reproducibility"),
    output_dir: tool.schema
      .string()
      .describe(
        "Output directory where the generated video will be saved. The directory will be created if it doesn't exist. Required.",
      ),
  },
  async execute(args, _context) {
    const token = getEnv("REPLICATE_API_TOKEN");
    if (!token) return "Error: REPLICATE_API_TOKEN not set.";

    if (!args.prompt) return "Error: 'prompt' is required.";
    if (!args.output_dir)
      return "Error: 'output_dir' is required. Specify where to save the output.";

    const replicate = new Replicate({ auth: token });
    const outputDir = resolve(args.output_dir);

    const rawDuration = args.duration ?? 5;
    const duration = rawDuration <= 7 ? 5 : 10;
    const aspectRatio = args.aspect_ratio ?? "16:9";
    const fps = args.fps ?? 24;

    const input: Record<string, unknown> = {
      prompt: args.prompt,
      duration,
      aspect_ratio: aspectRatio,
      fps,
      camera_fixed: args.camera_fixed ?? false,
      generate_audio: args.generate_audio ?? false,
    };

    if (args.seed !== undefined) input.seed = Math.floor(args.seed);

    if (args.image_path) {
      try {
        input.image = loadImageAsBase64(args.image_path);
      } catch (e) {
        return JSON.stringify(
          { success: false, error: e instanceof Error ? e.message : String(e) },
          null,
          2,
        );
      }
    }

    try {
      const output = await replicate.run(VIDEO_MODEL, { input });
      const { bytes, url } = await outputToBytes(output);

      const filename = `${slugify(args.prompt)}-${Date.now()}.mp4`;
      const outPath = resolve(outputDir, filename);
      ensureDir(outPath);
      writeFileSync(outPath, bytes);

      return JSON.stringify(
        {
          success: true,
          output_path: outPath,
          replicate_url: url,
          prompt: args.prompt,
          duration,
          aspect_ratio: aspectRatio,
          fps,
          mode: args.image_path ? "image-to-video" : "text-to-video",
          ...(args.image_path && { input_image: args.image_path }),
          file_size_bytes: bytes.length,
        },
        null,
        2,
      );
    } catch (e) {
      return JSON.stringify(
        { success: false, error: friendlyError(e) },
        null,
        2,
      );
    }
  },
});
