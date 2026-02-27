---
name: presentations
description: "Use this skill any time the user wants to create, edit, or export a slide deck presentation. This includes any task involving slides, decks, pitch decks, keynotes, or visual presentations. Trigger when the user says anything like 'create a presentation', 'make slides', 'build a deck', 'presentation about X'. The deliverable is a set of HTML slides (1920x1080) created via the presentation-gen tool, with optional PDF/PPTX export. Do NOT trigger for documents, reports, spreadsheets, or web pages — only slide deck presentations."
---

# Kortix Presentations — Slide Deck Creation Skill

You are loading the presentation creation skill. Follow these instructions for ALL presentation work.

---

## Autonomy Doctrine

**Act, don't ask.** Receive the topic, research it, design a custom theme, create all slides, validate, preview, export. No permission requests. No presenting options. Just deliver a complete, polished deck.

- **Decide the structure yourself.** Pick the right number of slides, the right layout, the right visuals.
- **Research before designing.** Never use generic colors. Find actual brand colors and visual identity.
- **Create all slides in parallel.** Don't build one at a time — batch them.
- **Validate and preview before delivering.** Fix any overflows or visual issues yourself.
- Only ask for clarification if the topic is completely unclear or genuinely ambiguous.

---

## Available Tools

- **`presentation-gen`** — Create, manage, validate, preview, and export slides.
  - `create_slide` — Create a single slide (HTML body content)
  - `list_slides` / `delete_slide` — Manage slides
  - `list_presentations` / `delete_presentation` — Manage presentations
  - `validate_slide` — Check dimensions via Playwright (must fit 1920x1080)
  - `export_pdf` — Render all slides to merged PDF via Playwright
  - `export_pptx` — 3-layer PPTX (background + visual elements + editable text) via Playwright + python-pptx
  - `preview` — Start local HTTP server at `http://localhost:3210` with keyboard nav, fullscreen, thumbnails
- **`image-search`** — Search Google Images. Batch queries with `|||` separator.
- **`image-gen`** — Generate images via Replicate (Flux Schnell). Actions: `generate`, `edit`, `upscale`, `remove_bg`.
- **`web-search`** — Search the web via Tavily. Batch queries with `|||` separator.
- **`scrape-webpage`** — Fetch and extract content from URLs via Firecrawl.

**CRITICAL**: ALWAYS use `presentation-gen` with `action: "create_slide"` to build slides. NEVER create slide HTML files manually.

---

## Folder Structure

```
presentations/
  images/                  ← shared images (downloaded BEFORE slides)
    hero.jpg
    logo.png
  [presentation-name]/     ← created automatically by create_slide
    metadata.json
    slide_01.html
    slide_02.html
    viewer.html            ← auto-generated on every create/delete
```

Images go to `presentations/images/` BEFORE the presentation folder exists. Reference images as `../images/[filename]` from slides.

---

## Efficiency Rules

1. **Batch searches** — Multiple queries in ONE call using `|||` separator
2. **Chain shell commands** — ALL folder creation + image downloads in ONE bash command
3. **Parallel slide creation** — Create ALL slides simultaneously (multiple `create_slide` calls at once)

---

# Creation Workflow

## Phase 1: Topic Confirmation

1. Extract the topic from the user's message
2. If clear enough to act on, proceed immediately with defaults:
   - Target audience: "General public" unless specified
   - Goals: "Informative overview" unless specified
3. Only ask for clarification if the topic is completely unclear

## Phase 2: Theme Design

1. **Batch web search for brand identity** — ALL in one call:
   - `[topic] brand colors`
   - `[topic] visual identity`
   - `[topic] official website design`
   - `[topic] brand guidelines`

2. **Define custom color scheme** based on research:
   - USE ACTUAL brand colors found in research
   - FORBIDDEN: "blue for tech", "red for speed", "green for innovation" without research backing
   - For companies: use their official brand colors
   - For people: find their associated visual identity
   - Document WHERE you found the color information
   - Define: primary, secondary, accent, text color, font choices, layout patterns

## Phase 3: Research and Content Planning

Complete ALL steps including ALL image downloads before Phase 4.

1. **Batch content research** — ALL in one call:
   - `[topic] history background`
   - `[topic] key features`
   - `[topic] statistics data facts`
   - `[topic] significance impact`
   - Scrape key pages for detail

2. **Create content outline** — one main idea per slide. Note a TOPIC-SPECIFIC image query for each slide (always include the actual topic name/brand/person — never generic category queries).

3. **Batch image search** — ALL queries in one call with `num_results: 2`

4. **Select images** based on:
   - Topic specificity (actual brand/person images, not generic stock)
   - Dimensions (landscape for backgrounds, portrait for side panels)
   - Visual quality and relevance

5. **Download ALL images in one command**:
   ```bash
   mkdir -p presentations/images && \
   curl -L "URL1" -o presentations/images/slide1_hero.jpg && \
   curl -L "URL2" -o presentations/images/slide2_detail.jpg && \
   ls -lh presentations/images/
   ```
   Verify ALL expected files exist. Retry any failures.

6. **Document image mapping**: slide number -> filename, dimensions, orientation, placement

## Phase 4: Slide Creation

Only start after Phase 3 is complete with all images downloaded and verified.

1. **Create ALL slides in parallel** — multiple `create_slide` calls simultaneously:
   ```
   presentation-gen(
     action: "create_slide",
     presentation_name: "my_pres",
     slide_number: 1,
     slide_title: "Introduction",
     content: "<div>...</div>",
     presentation_title: "My Presentation"
   )
   ```

2. **Use downloaded images** — Reference as `../images/filename` in `<img>` tags:
   - Landscape → full-width backgrounds, hero images
   - Portrait → side panels, accent images
   - Square → centered focal points, logos

## Phase 5: Validate, Preview, Export

1. **Validate** — `presentation-gen` with `action: "validate_slide"` on each slide. Fix any overflows (content exceeding 1920x1080).

2. **Preview** — `presentation-gen` with `action: "preview"` to launch viewer at `http://localhost:3210`.

3. **Export** — both formats:
   - `action: "export_pdf"` — merged PDF via Playwright
   - `action: "export_pptx"` — 3-layer PPTX (background + visuals + editable text)

   Both require `presentation_name`. Output saved in the presentation folder.

## Phase 6: Deliver

Review all slides for visual consistency, then report:
- What was created (topic, slide count, theme)
- Viewer URL: `http://localhost:3210`
- Paths to exported PDF and PPTX files

---

# Slide Content Rules

## HTML Rules

- HTML body content ONLY — no `<!DOCTYPE>`, `<html>`, `<head>`, `<body>` tags (added automatically)
- Inter font is pre-loaded — use it directly
- Use emoji for icons — no Font Awesome or icon libraries
- Design for FIXED **1920x1080 pixels** — NOT responsive
- `box-sizing: border-box` on all containers
- Max 40px container padding
- `overflow: hidden` on all containers

## Typography

| Element | Size | Weight |
|---|---|---|
| Titles | 48-72px | 700-900 |
| Subtitles | 32-42px | 600-700 |
| Headings | 28-36px | 600 |
| Body | 20-24px | 400-500 |
| Small/captions | 16-18px | 300-400 |

Line height: 1.5-1.8 for all text.

## Layout — PRESENTATION, NOT WEBSITE

**FORBIDDEN:**
- Multi-column card grids
- Responsive patterns, `vw`/`vh` units, media queries
- Scrolling content
- More than 5 bullet points per slide
- More than 2 ideas per slide

**REQUIRED:**
- Centered, focused content
- Large titles with visual impact
- Fixed pixel dimensions only
- 1-2 ideas per slide max
- 3-5 bullet points max
- Think PowerPoint: large title, centered content, minimal elements

## Color Usage

- **Primary** — backgrounds, main elements
- **Secondary** — subtle backgrounds, section dividers
- **Accent** — highlights, CTAs, key numbers
- **Text** — all text content
- Consistent scheme across ALL slides — no slide should look like it belongs to a different deck

## Image Placement Patterns

### Full-bleed background
```html
<div style="position:absolute;inset:0;background:url('../images/hero.jpg') center/cover;"></div>
<div style="position:absolute;inset:0;background:rgba(0,0,0,0.5);"></div>
<div style="position:relative;z-index:1;padding:60px;">
  <!-- content over darkened image -->
</div>
```

### Side panel (40/60 split)
```html
<div style="display:flex;width:1920px;height:1080px;">
  <div style="width:40%;background:url('../images/photo.jpg') center/cover;"></div>
  <div style="width:60%;padding:60px;display:flex;flex-direction:column;justify-content:center;">
    <!-- content -->
  </div>
</div>
```

### Centered accent image
```html
<div style="text-align:center;padding:40px;">
  <img src="../images/logo.png" style="max-height:300px;margin:0 auto 30px;">
  <!-- content below -->
</div>
```

## Data Visualization

D3.js and Chart.js are pre-loaded. Use them for charts, graphs, and data visualizations directly in slide HTML.

```html
<canvas id="myChart" width="800" height="400"></canvas>
<script>
new Chart(document.getElementById('myChart'), {
  type: 'bar',
  data: {
    labels: ['Q1', 'Q2', 'Q3', 'Q4'],
    datasets: [{
      label: 'Revenue ($M)',
      data: [12, 19, 8, 15],
      backgroundColor: '#1F4E79'
    }]
  },
  options: { responsive: false }
});
</script>
```

---

# Slide Templates

## Title Slide
```html
<div style="width:1920px;height:1080px;display:flex;flex-direction:column;justify-content:center;align-items:center;background:linear-gradient(135deg,PRIMARY,SECONDARY);padding:80px;box-sizing:border-box;">
  <h1 style="font-size:64px;font-weight:800;color:#fff;text-align:center;margin:0 0 20px;">
    Presentation Title
  </h1>
  <p style="font-size:28px;font-weight:400;color:rgba(255,255,255,0.8);text-align:center;">
    Subtitle or tagline
  </p>
</div>
```

## Content Slide (title + bullets)
```html
<div style="width:1920px;height:1080px;padding:60px 80px;box-sizing:border-box;background:#fff;display:flex;flex-direction:column;">
  <h2 style="font-size:48px;font-weight:700;color:PRIMARY;margin:0 0 40px;">
    Section Title
  </h2>
  <ul style="font-size:24px;line-height:1.8;color:#333;list-style:none;padding:0;">
    <li style="margin-bottom:20px;">&#x2022; First key point with supporting detail</li>
    <li style="margin-bottom:20px;">&#x2022; Second key point with supporting detail</li>
    <li style="margin-bottom:20px;">&#x2022; Third key point with supporting detail</li>
  </ul>
</div>
```

## Stats/Numbers Slide
```html
<div style="width:1920px;height:1080px;padding:60px 80px;box-sizing:border-box;background:PRIMARY;display:flex;flex-direction:column;justify-content:center;">
  <h2 style="font-size:42px;font-weight:700;color:#fff;margin:0 0 60px;text-align:center;">
    Key Numbers
  </h2>
  <div style="display:flex;justify-content:space-around;">
    <div style="text-align:center;">
      <div style="font-size:72px;font-weight:900;color:ACCENT;">$2.5B</div>
      <div style="font-size:20px;color:rgba(255,255,255,0.8);margin-top:10px;">Revenue</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:72px;font-weight:900;color:ACCENT;">150K+</div>
      <div style="font-size:20px;color:rgba(255,255,255,0.8);margin-top:10px;">Customers</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:72px;font-weight:900;color:ACCENT;">98%</div>
      <div style="font-size:20px;color:rgba(255,255,255,0.8);margin-top:10px;">Satisfaction</div>
    </div>
  </div>
</div>
```

## Quote Slide
```html
<div style="width:1920px;height:1080px;display:flex;align-items:center;justify-content:center;background:SECONDARY;padding:120px;box-sizing:border-box;">
  <div style="max-width:1200px;text-align:center;">
    <div style="font-size:120px;color:ACCENT;line-height:1;margin-bottom:20px;">"</div>
    <p style="font-size:36px;font-weight:500;color:PRIMARY;line-height:1.6;font-style:italic;">
      The quote text goes here, keeping it impactful and concise.
    </p>
    <p style="font-size:20px;color:#666;margin-top:30px;">— Attribution Name, Title</p>
  </div>
</div>
```

## Closing/CTA Slide
```html
<div style="width:1920px;height:1080px;display:flex;flex-direction:column;justify-content:center;align-items:center;background:linear-gradient(135deg,PRIMARY,SECONDARY);padding:80px;box-sizing:border-box;">
  <h2 style="font-size:56px;font-weight:800;color:#fff;text-align:center;margin:0 0 30px;">
    Thank You
  </h2>
  <p style="font-size:24px;color:rgba(255,255,255,0.8);text-align:center;">
    Contact info or call to action
  </p>
</div>
```

---

# Presentation Viewer

A polished slide viewer and preview server for HTML presentations (1920x1080).

## Architecture

The viewer consists of two parts:

1. **`viewer.html`** — a self-contained HTML template that renders slides in scaled iframes with keyboard navigation, fullscreen, and a thumbnail strip.
2. **`serve.ts`** — a lightweight Bun HTTP server that serves the presentation folder and injects the viewer at `/`.

Both files live in `skills/presentations/` alongside this SKILL.md.

## Why a Server (Not Just a Static HTML File)?

Standalone 1920x1080 HTML slides opened directly in a browser are an unscaled, scrollable mess. The viewer fixes this by loading slides into iframes and CSS-scaling them to fit any viewport.

The problem: **loading `<iframe src="slide_XX.html">` does not work reliably over `file://`**. Browsers enforce CORS/sandboxing restrictions on `file://` origins. An HTTP server on `localhost` eliminates all of this.

## In the Sandbox (Container)

**The viewer is already running as a service inside the sandbox container.** It starts automatically on boot via s6-overlay and listens on **port 3210**.

- The service watches `/workspace/presentations/` for any presentation with a `metadata.json`
- It serves the most recently created/updated presentation at `http://localhost:3210`
- Port 3210 is exposed in docker-compose and mapped to the host

**The agent does not need to start the server manually.** After creating slides, tell the user to open `http://localhost:3210`.

| Item | Value |
|------|-------|
| Service location | `/etc/s6-overlay/s6-rc.d/svc-presentation-viewer/run` |
| Viewer files | `/opt/opencode/skills/presentations/` |
| Port | `3210` (mapped to host) |
| Presentations dir | `/workspace/presentations/` |
| Managed by | s6-overlay (auto-restart on crash) |

## Local Development (Outside Container)

```bash
bun run .opencode/skills/presentations/serve.ts presentations/my-deck
```

Or via the `presentation-gen` tool:

```
presentation-gen(action: "preview", presentation_name: "my-deck")
```

## Viewer Controls

| Key | Action |
|-----|--------|
| `→` / `Space` / `↓` | Next slide |
| `←` / `↑` | Previous slide |
| `Home` | First slide |
| `End` | Last slide |
| `F` | Toggle fullscreen |
| `T` | Toggle thumbnail strip |
| `?` | Toggle keyboard shortcuts |
| `Esc` | Exit fullscreen / close panels |
| Swipe left/right | Navigate (touch) |

## How Scaling Works

Each slide is a 1920x1080 iframe. The viewer measures the stage area, computes `min(availWidth / 1920, availHeight / 1080)`, sets the wrapper to displayed pixel size, and applies `transform: scale(factor)` with `transform-origin: 0 0`. The 16:9 aspect ratio is maintained at any viewport size.
