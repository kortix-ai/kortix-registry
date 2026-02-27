/**
 * Tunnel Tools — OpenCode sandbox tools for interacting with user's local machine
 * via the Kortix reverse-tunnel infrastructure.
 *
 * Each tool calls POST /v1/tunnel/rpc/:tunnelId on kortix-api,
 * which relays the request to the user's local agent over WebSocket.
 *
 * Tools:
 *   tunnel_status     — check tunnel connection status + capabilities
 *   tunnel_fs_read    — read a file from the user's local machine
 *   tunnel_fs_write   — write a file to the user's local machine
 *   tunnel_fs_list    — list directory contents on the user's local machine
 *   tunnel_shell_exec — execute a command on the user's local machine
 */

import { tool } from "@opencode-ai/plugin"
import { tunnelRpc, resolveTunnelId, getTunnelBase, getToken } from "./rpc"

// ─── Tool Definitions ────────────────────────────────────────────────────────

export const tunnelStatusTool = tool({
	description: `Check the status of a Kortix Tunnel connection to the user's local machine. Returns connection status, available capabilities (filesystem, shell, etc.), and machine info. Use this to verify the tunnel is connected before attempting local operations.`,
	args: {
		tunnel_id: tool.schema.string().optional().describe("Tunnel connection ID (defaults to KORTIX_TUNNEL_ID env var)"),
	},
	async execute(args) {
		const tunnelId = await resolveTunnelId(args)
		const token = getToken()

		const res = await fetch(`${getTunnelBase()}/connections/${tunnelId}`, {
			headers: { Authorization: `Bearer ${token}` },
		})

		if (!res.ok) {
			if (res.status === 404) {
				return "Tunnel connection not found. The user needs to set up Kortix Tunnel first."
			}
			return `Failed to check tunnel status: HTTP ${res.status}`
		}

		const data = (await res.json()) as Record<string, unknown>
		const status = data.isLive ? "ONLINE" : "OFFLINE"
		const capabilities = (data.capabilities as string[]) || []
		const machineInfo = data.machineInfo as Record<string, unknown> || {}

		const lines = [
			`=== Tunnel Status: ${status} ===`,
			`ID: ${data.tunnelId}`,
			`Name: ${data.name}`,
			`Capabilities: ${capabilities.length > 0 ? capabilities.join(", ") : "(none registered)"}`,
		]

		if (Object.keys(machineInfo).length > 0) {
			lines.push(`Machine: ${machineInfo.hostname || "unknown"} (${machineInfo.platform || "?"} ${machineInfo.arch || "?"})`)
		}

		if (!data.isLive) {
			lines.push("", "The tunnel agent is not currently connected. Ask the user to run `npx @kortix/tunnel connect` on their local machine.")
		}

		return lines.join("\n")
	},
})

export const tunnelFsReadTool = tool({
	description: `Read a file from the user's local machine via Kortix Tunnel. The file content is transferred securely through the tunnel relay. Requires filesystem permission — if not granted, a permission request will be sent to the user for approval.`,
	args: {
		tunnel_id: tool.schema.string().optional().describe("Tunnel connection ID (defaults to KORTIX_TUNNEL_ID env var)"),
		path: tool.schema.string().describe("Absolute path to the file on the user's local machine"),
		encoding: tool.schema.string().optional().describe("File encoding (default: utf-8)"),
	},
	async execute(args) {
		const tunnelId = await resolveTunnelId(args)
		const result = await tunnelRpc(tunnelId, "fs.read", {
			path: args.path,
			encoding: args.encoding || "utf-8",
		})

		if (typeof result === "string") return result // Permission request message

		const data = result as Record<string, unknown>
		return `=== File: ${args.path} (${data.size} bytes) ===\n${data.content}`
	},
})

export const tunnelFsWriteTool = tool({
	description: `Write a file to the user's local machine via Kortix Tunnel. Creates parent directories if needed. Requires filesystem write permission — if not granted, a permission request will be sent to the user.`,
	args: {
		tunnel_id: tool.schema.string().optional().describe("Tunnel connection ID (defaults to KORTIX_TUNNEL_ID env var)"),
		path: tool.schema.string().describe("Absolute path for the file on the user's local machine"),
		content: tool.schema.string().describe("File content to write"),
		encoding: tool.schema.string().optional().describe("File encoding (default: utf-8)"),
	},
	async execute(args) {
		const tunnelId = await resolveTunnelId(args)
		const result = await tunnelRpc(tunnelId, "fs.write", {
			path: args.path,
			content: args.content,
			encoding: args.encoding || "utf-8",
		})

		if (typeof result === "string") return result

		const data = result as Record<string, unknown>
		return `File written: ${data.path} (${data.size} bytes)`
	},
})

export const tunnelFsListTool = tool({
	description: `List directory contents on the user's local machine via Kortix Tunnel. Returns file names, types (file/directory/symlink), and paths. Requires filesystem permission.`,
	args: {
		tunnel_id: tool.schema.string().optional().describe("Tunnel connection ID (defaults to KORTIX_TUNNEL_ID env var)"),
		path: tool.schema.string().describe("Absolute path to the directory on the user's local machine"),
		recursive: tool.schema.boolean().optional().describe("Include subdirectory contents (default: false)"),
	},
	async execute(args) {
		const tunnelId = await resolveTunnelId(args)
		const result = await tunnelRpc(tunnelId, "fs.list", {
			path: args.path,
			recursive: args.recursive || false,
		})

		if (typeof result === "string") return result

		const data = result as { entries: Array<{ name: string; path: string; isDirectory: boolean; isFile: boolean }>; count: number }

		if (data.entries.length === 0) {
			return `Directory is empty: ${args.path}`
		}

		const lines = [`=== Directory: ${args.path} (${data.count} entries) ===`]
		for (const entry of data.entries) {
			const type = entry.isDirectory ? "[DIR]" : "[FILE]"
			lines.push(`  ${type} ${entry.name}`)
		}

		return lines.join("\n")
	},
})

export const tunnelShellExecTool = tool({
	description: `Execute a command on the user's local machine via Kortix Tunnel. Commands are executed without shell interpolation (array args) for security. Requires shell permission — if not granted, a permission request will be sent to the user.`,
	args: {
		tunnel_id: tool.schema.string().optional().describe("Tunnel connection ID (defaults to KORTIX_TUNNEL_ID env var)"),
		command: tool.schema.string().describe("Command executable name (e.g., 'ls', 'git', 'python')"),
		args: tool.schema.array(tool.schema.string()).optional().describe("Command arguments as separate strings (no shell interpolation)"),
		cwd: tool.schema.string().optional().describe("Working directory for the command"),
		timeout: tool.schema.number().optional().describe("Timeout in milliseconds (default: 30000, max: 120000)"),
	},
	async execute(args) {
		const tunnelId = await resolveTunnelId(args)
		const result = await tunnelRpc(tunnelId, "shell.exec", {
			command: args.command,
			args: args.args || [],
			cwd: args.cwd,
			timeout: args.timeout,
		})

		if (typeof result === "string") return result

		const data = result as {
			exitCode: number | null
			signal: string | null
			stdout: string
			stderr: string
			stdoutTruncated: boolean
			stderrTruncated: boolean
		}

		const lines = [`=== Command: ${args.command} ${(args.args || []).join(" ")} ===`]
		lines.push(`Exit code: ${data.exitCode ?? "N/A"}${data.signal ? ` (signal: ${data.signal})` : ""}`)

		if (data.stdout) {
			lines.push(`\n--- stdout${data.stdoutTruncated ? " (truncated)" : ""} ---`)
			lines.push(data.stdout)
		}

		if (data.stderr) {
			lines.push(`\n--- stderr${data.stderrTruncated ? " (truncated)" : ""} ---`)
			lines.push(data.stderr)
		}

		return lines.join("\n")
	},
})
