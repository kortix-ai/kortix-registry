---
name: hol-guard
description: "Install and use HOL Guard to protect supported local coding and AI-agent harnesses before MCP servers, skills, hooks, plugins, and risky package or command actions run. Use when an agent needs local execution guardrails, approval-aware launches, package-install preflight, receipts, or Guard diagnostics."
---

# HOL Guard

Use HOL Guard as the local safety boundary for supported agent and coding harnesses. Keep the protection boundary explicit: this skill is installable from the Kortix registry, but it must not assume that Kortix/OpenCode itself is a HOL Guard harness. Always detect support first.

## Install

Prefer an isolated `pipx` install and pin the currently verified stable release:

```bash
pipx install "hol-guard==3.0.11"
hol-guard --version
```

If `pipx` is unavailable, do not silently modify a system Python environment. Ask before choosing another Python environment or installation method.

## Detect the protection boundary

```bash
hol-guard detect --json
```

Only use harness identifiers returned by HOL Guard. Do not invent an adapter name or claim that an undetected runtime is protected.

For a manual setup inspection:

```bash
hol-guard bootstrap
```

For a supported harness returned by `detect`:

```bash
hol-guard install <harness>
hol-guard run <harness> --dry-run
hol-guard run <harness>
```

If the protected launch pauses for a decision, inspect the request instead of bypassing Guard:

```bash
hol-guard approvals
hol-guard diff <harness>
hol-guard receipts
hol-guard status
```

## Package and command preflight

Before a risky package install, preview the exact operation first. Example:

```bash
hol-guard protect npm install <package> --dry-run
```

To inspect command-safety coverage without executing the command or creating Guard state:

```bash
hol-guard command test '<command>'
hol-guard command explain '<command>'
```

These command-inspection operations are not a substitute for a protected harness launch.

## Troubleshooting

```bash
hol-guard status
hol-guard doctor <harness> --json
hol-guard inventory
hol-guard events
```

If `detect` does not report the runtime you intended to protect, stop and state that boundary clearly. Do not route around Guard or represent package/command inspection as full runtime enforcement.

## Source of truth

- Project: https://github.com/hashgraph-online/hol-guard
- Get started: https://github.com/hashgraph-online/hol-guard/blob/main/docs/guard/get-started.md
- Stable release used by this skill: v3.0.11
