/**
 * Lightweight presentation preview server.
 *
 * Serves a presentation folder over HTTP with a polished slide viewer.
 * Resolves the file:// iframe/CORS issues that make raw HTML viewing broken.
 *
 * Usage: bun run serve.ts <presentation-dir>
 *   e.g. bun run serve.ts presentations/marko-kraemer
 *        PORT=4000 bun run serve.ts presentations/my-deck
 */

import { readFileSync, existsSync, statSync } from "fs";
import { resolve, join, extname, dirname } from "path";
import { execSync } from "child_process";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".pdf": "application/pdf",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function getMime(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream";
}

function serveFile(filePath: string): Response {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return new Response("Not found", { status: 404 });
  }
  const data = readFileSync(filePath);
  return new Response(data, {
    headers: { "Content-Type": getMime(filePath), "Cache-Control": "no-cache" },
  });
}

const presArg = process.argv[2];
if (!presArg) {
  console.error("Usage: bun run serve.ts <presentation-dir>");
  console.error("  e.g. bun run serve.ts presentations/marko-kraemer");
  process.exit(1);
}

const presDir = resolve(presArg);
const metaPath = join(presDir, "metadata.json");

if (!existsSync(metaPath)) {
  console.error(`Error: metadata.json not found in ${presDir}`);
  process.exit(1);
}

const metadata = JSON.parse(readFileSync(metaPath, "utf-8"));
const parentDir = dirname(presDir);
const viewerTemplatePath = resolve(dirname(new URL(import.meta.url).pathname), "viewer.html");

function buildViewerHtml(): string {
  const slides = Object.entries(metadata.slides || {})
    .map(([num, data]: [string, any]) => ({
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
  return template
    .replace("{{TITLE}}", metadata.title || "Presentation")
    .replace("{{PRESENTATION_DATA}}", presData);
}

const port = parseInt(process.env.PORT || "3210");

const server = Bun.serve({
  port,
  fetch(req) {
    const url = new URL(req.url);
    let pathname = decodeURIComponent(url.pathname);

    if (
      pathname === "/" ||
      pathname === "/index.html" ||
      pathname === "/viewer" ||
      pathname === "/viewer.html"
    ) {
      const html = buildViewerHtml();
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
      });
    }

    if (pathname.startsWith("/../images/") || pathname.startsWith("/%2E%2E/images/")) {
      const imgPath = join(parentDir, "images", pathname.replace(/^\/(\.\.\/|%2E%2E\/)images\//, ""));
      return serveFile(imgPath);
    }

    if (pathname.startsWith("/images/")) {
      const imgPath = join(parentDir, "images", pathname.replace(/^\/images\//, ""));
      return serveFile(imgPath);
    }

    const filePath = join(presDir, pathname.slice(1));
    return serveFile(filePath);
  },
});

const url = `http://localhost:${server.port}`;
console.log(`\n  Presentation Viewer`);
console.log(`  ${metadata.title || metadata.presentation_name || "Presentation"}`);
console.log(`  ${Object.keys(metadata.slides || {}).length} slides\n`);
console.log(`  ${url}\n`);
console.log(`  Press Ctrl+C to stop\n`);

try {
  const platform = process.platform;
  if (platform === "darwin") {
    execSync(`open "${url}"`, { stdio: "ignore" });
  } else if (platform === "linux") {
    execSync(`xdg-open "${url}"`, { stdio: "ignore" });
  } else if (platform === "win32") {
    execSync(`start "${url}"`, { stdio: "ignore" });
  }
} catch {
  /* browser auto-open is best-effort */
}
