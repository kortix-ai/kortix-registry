# Kortix Registry

> AI agent capabilities for the Kortix sandbox platform. Skills, tools, plugins, and agents — installable via [OCX](https://github.com/kdcokenny/ocx).

## Quick Start

```bash
ocx init
ocx registry add https://registry.kortix.ai --name kortix
ocx add kortix/sandbox
```

## Bundles

| Name | Description | Command |
|------|-------------|---------|
| sandbox | Full Kortix sandbox experience | `ocx add kortix/sandbox` |
| research | Deep research, academic papers, web search | `ocx add kortix/research` |
| documents | Word, Excel, PDF, presentations, legal docs | `ocx add kortix/documents` |
| media | Images, videos, logos, audio generation | `ocx add kortix/media` |
| integrations | Third-party OAuth integrations | `ocx add kortix/integrations` |

## Skills (18)

| Name | Description | Command |
|------|-------------|---------|
| deep-research | Thorough, evidence-based research with cited reports | `ocx add kortix/deep-research` |
| agent-browser | Browser automation — navigate, fill forms, screenshot | `ocx add kortix/agent-browser` |
| docx | Create and manipulate Word documents | `ocx add kortix/docx` |
| xlsx | Spreadsheet operations — formulas, charts, formatting | `ocx add kortix/xlsx` |
| pdf | PDF operations — merge, split, fill forms, OCR | `ocx add kortix/pdf` |
| presentations | Slide deck creation with PDF/PPTX export | `ocx add kortix/presentations` |
| remotion | Video creation in React | `ocx add kortix/remotion` |
| legal-writer | Legal document drafting with Bluebook citations | `ocx add kortix/legal-writer` |
| paper-creator | Scientific paper writing in LaTeX | `ocx add kortix/paper-creator` |
| openalex-paper-search | Academic paper search (240M+ works) | `ocx add kortix/openalex-paper-search` |
| logo-creator | Professional logo creation with AI | `ocx add kortix/logo-creator` |
| email | Send/receive email via IMAP/SMTP | `ocx add kortix/email` |
| elevenlabs | Text-to-speech, voice cloning, sound effects | `ocx add kortix/elevenlabs` |
| domain-research | Domain availability checking via RDAP/WHOIS | `ocx add kortix/domain-research` |
| fullstack-vite-convex | Full-stack web dev with Convex + Vite React | `ocx add kortix/fullstack-vite-convex` |
| kortix-system | Kortix sandbox system reference | `ocx add kortix/kortix-system` |
| opencode-reference | OpenCode framework reference | `ocx add kortix/opencode-reference` |
| woa | Wisdom of Agents forum | `ocx add kortix/woa` |

## Tools (17)

| Name | Description | Command |
|------|-------------|---------|
| web-search | Web search via Tavily | `ocx add kortix/web-search` |
| scrape-webpage | Web content extraction via Firecrawl | `ocx add kortix/scrape-webpage` |
| image-gen | AI image generation/editing via Replicate | `ocx add kortix/image-gen` |
| image-search | Google Images search via Serper | `ocx add kortix/image-search` |
| video-gen | Video generation via Replicate | `ocx add kortix/video-gen` |
| presentation-gen | HTML slide creation and export | `ocx add kortix/presentation-gen` |
| show | Show outputs to users (images, files, code) | `ocx add kortix/show` |
| cron-triggers | Scheduled task management | `ocx add kortix/cron-triggers` |
| woa-find | Search the WoA forum | `ocx add kortix/woa-find` |
| woa-create | Post to the WoA forum | `ocx add kortix/woa-create` |
| integration-* | 7 tools for OAuth integrations | `ocx add kortix/integrations` |

## Plugins (2)

| Name | Description | Command |
|------|-------------|---------|
| kortix-memory | Long-term memory with hybrid BM25+vector search | `ocx add kortix/kortix-memory` |
| kortix-tunnel | Local machine interaction via tunnel | `ocx add kortix/kortix-tunnel` |

## Development

```bash
bun install
bun run build     # Build registry to dist/
bun run dev       # Local dev server at localhost:8787
bun run deploy    # Deploy to Cloudflare Workers
```

## License

MIT
