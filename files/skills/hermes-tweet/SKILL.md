---
name: hermes-tweet
description: "Hermes Agent X/Twitter workflows through Hermes Tweet. Use when a Hermes session needs X/Twitter search, account reads, trend checks, social listening, launch monitoring, support triage, giveaway audits, or approval-gated publishing through the installed hermes-tweet plugin."
---

# Hermes Tweet

Use this skill when a Hermes Agent session needs X/Twitter context or controlled
publishing through the Hermes Tweet plugin.

This skill is an operator guide for the existing Hermes Tweet runtime. It does
not contain credentials and does not replace the plugin package. Install and
enable `hermes-tweet` on the Hermes runtime host before expecting its tools.

## Prerequisites

- Hermes Tweet installed and enabled in Hermes Agent.
- `XQUIK_API_KEY` configured in the runtime environment for read tools.
- `HERMES_TWEET_ENABLE_ACTIONS=true` only when the session intentionally allows
  account-changing actions.

Keep secrets in the runtime environment. Never paste API keys, cookies,
passwords, signing keys, or TOTP secrets into chat, prompts, examples, logs, or
tool arguments.

## Workflow

1. Use `tweet_explore` to find the catalog route.
2. Use `tweet_read` for public read-only `GET` routes.
3. Use `tweet_action` only after the user approves an account-changing action,
   private read, monitor, webhook, extraction job, media operation, or giveaway
   draw.

## Decision Rules

- If the task is route discovery, call `tweet_explore` with a short query.
- If the route is a public read-only `GET`, call `tweet_read`.
- If the route writes data or touches private account state, call
  `tweet_action` only when actions are enabled and the user approved the exact
  operation.
- If `tweet_action` is missing or disabled, explain that writes are gated by
  `HERMES_TWEET_ENABLE_ACTIONS=true`.
- If `XQUIK_API_KEY` is missing, ask the user to configure it where Hermes
  executes. Do not ask for the value.

## Safe Use Cases

- Social listening and brand monitoring.
- Launch, mention, trend, and account checks.
- Support triage and creator research.
- Giveaway and community audits.
- Drafting or posting only after explicit user approval.

## Safety

- Use only catalog-listed `/api/v1/...` routes returned by `tweet_explore`.
- Do not guess endpoint paths.
- Do not use account connection, re-authentication, API-key, billing,
  credit top-up, or support-ticket routes.
- Summarize posting, deleting, following, DMs, profile changes, monitors,
  webhooks, extraction jobs, and draws before calling `tweet_action`.
- Do not retry writes through alternate routes after a policy, authentication,
  or account-state error.

## Reference

- Source: https://github.com/Xquik-dev/hermes-tweet
- License: MIT
