import { tool } from "@opencode-ai/plugin"
import { writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { randomBytes } from "crypto"
import { tunnelRpc, resolveTunnelId } from "./rpc"

function saveImage(base64: string, format: string): string {
	const ext = format === "jpeg" || format === "jpg" ? "jpg" : "png"
	const dir = join(tmpdir(), "kortix-screenshots")
	mkdirSync(dir, { recursive: true })
	const path = join(dir, `screenshot-${randomBytes(4).toString("hex")}.${ext}`)
	writeFileSync(path, Buffer.from(base64, "base64"))
	return path
}

const tunnelIdArg = tool.schema.string().optional().describe("Tunnel connection ID (auto-discovered if omitted)")

export const tunnelScreenshotTool = tool({
	description: `Take a screenshot of the user's screen via Kortix Tunnel. Saves the image to a temp file and returns the path. Use the Read tool on the returned path to view the screenshot.`,
	args: {
		tunnel_id: tunnelIdArg,
		x: tool.schema.number().optional().describe("Region X coordinate"),
		y: tool.schema.number().optional().describe("Region Y coordinate"),
		width: tool.schema.number().optional().describe("Region width"),
		height: tool.schema.number().optional().describe("Region height"),
		windowId: tool.schema.number().optional().describe("Capture a specific window by ID"),
	},
	async execute(args) {
		const tunnelId = await resolveTunnelId(args)
		const params: Record<string, unknown> = {}

		if (args.x !== undefined && args.y !== undefined && args.width !== undefined && args.height !== undefined) {
			params.region = { x: args.x, y: args.y, width: args.width, height: args.height }
		}
		if (args.windowId !== undefined) {
			params.windowId = args.windowId
		}

		const result = await tunnelRpc(tunnelId, "desktop.screenshot", params)
		if (typeof result === "string") return result

		const data = result as { image: string; width: number; height: number; format?: string }
		const format = data.format || "png"
		const sizeKB = Math.round(data.image.length * 0.75 / 1024)
		const path = saveImage(data.image, format)
		return `Screenshot saved: ${path}\nDimensions: ${data.width}x${data.height} ${format.toUpperCase()} (${sizeKB}KB)\n\nUse the Read tool to view this image.`
	},
})

export const tunnelClickTool = tool({
	description: `Click at a specific screen coordinate on the user's machine via Kortix Tunnel. Supports left/right/middle click, double-click, and modifier keys.`,
	args: {
		tunnel_id: tunnelIdArg,
		x: tool.schema.number().describe("X coordinate to click"),
		y: tool.schema.number().describe("Y coordinate to click"),
		button: tool.schema.enum(["left", "right", "middle"]).optional().describe("Mouse button (default: left)"),
		clicks: tool.schema.number().optional().describe("Number of clicks (default: 1, use 2 for double-click)"),
		modifiers: tool.schema.array(tool.schema.string()).optional().describe("Modifier keys held during click: cmd, shift, alt, ctrl"),
	},
	async execute(args) {
		const tunnelId = await resolveTunnelId(args)
		const result = await tunnelRpc(tunnelId, "desktop.mouse.click", {
			x: args.x,
			y: args.y,
			button: args.button,
			clicks: args.clicks,
			modifiers: args.modifiers,
		})
		if (typeof result === "string") return result
		return `Clicked at (${args.x}, ${args.y}) [${args.button || "left"}]${args.clicks && args.clicks > 1 ? ` x${args.clicks}` : ""}`
	},
})

export const tunnelTypeTool = tool({
	description: `Type text into the currently focused application on the user's machine via Kortix Tunnel. The text is typed character by character as if from a keyboard.`,
	args: {
		tunnel_id: tunnelIdArg,
		text: tool.schema.string().describe("Text to type"),
		delay: tool.schema.number().optional().describe("Delay between characters in ms"),
	},
	async execute(args) {
		const tunnelId = await resolveTunnelId(args)
		const result = await tunnelRpc(tunnelId, "desktop.keyboard.type", {
			text: args.text,
			delay: args.delay,
		})
		if (typeof result === "string") return result
		return `Typed ${args.text.length} characters`
	},
})

export const tunnelKeyTool = tool({
	description: `Press a key combination on the user's machine via Kortix Tunnel. Use for keyboard shortcuts like cmd+s, ctrl+c, enter, tab, etc.`,
	args: {
		tunnel_id: tunnelIdArg,
		keys: tool.schema.array(tool.schema.string()).describe("Keys to press simultaneously. Examples: ['cmd', 's'] for save, ['enter'] for enter, ['ctrl', 'shift', 'p'] for command palette"),
	},
	async execute(args) {
		const tunnelId = await resolveTunnelId(args)
		const result = await tunnelRpc(tunnelId, "desktop.keyboard.key", { keys: args.keys })
		if (typeof result === "string") return result
		return `Pressed: ${args.keys.join("+")}`
	},
})

export const tunnelWindowListTool = tool({
	description: `List all visible windows on the user's machine via Kortix Tunnel. Returns window IDs, app names, titles, positions, and sizes. Use window IDs with other window tools.`,
	args: {
		tunnel_id: tunnelIdArg,
	},
	async execute(args) {
		const tunnelId = await resolveTunnelId(args)
		const result = await tunnelRpc(tunnelId, "desktop.window.list", {})
		if (typeof result === "string") return result

		const data = result as { windows: Array<{ id: number; app: string; title: string; bounds: { x: number; y: number; width: number; height: number }; minimized: boolean }> }

		if (data.windows.length === 0) return "No windows found"

		const lines = [`=== Windows (${data.windows.length}) ===`]
		for (const w of data.windows) {
			const min = w.minimized ? " [minimized]" : ""
			lines.push(`  #${w.id} | ${w.app} — "${w.title}" | ${w.bounds.x},${w.bounds.y} ${w.bounds.width}x${w.bounds.height}${min}`)
		}
		return lines.join("\n")
	},
})

export const tunnelWindowFocusTool = tool({
	description: `Bring a window to the front on the user's machine via Kortix Tunnel. Use tunnel_window_list to find window IDs.`,
	args: {
		tunnel_id: tunnelIdArg,
		windowId: tool.schema.number().describe("Window ID from tunnel_window_list"),
	},
	async execute(args) {
		const tunnelId = await resolveTunnelId(args)
		const result = await tunnelRpc(tunnelId, "desktop.window.focus", { windowId: args.windowId })
		if (typeof result === "string") return result
		return `Window #${args.windowId} focused`
	},
})

export const tunnelAppLaunchTool = tool({
	description: `Launch an application on the user's machine via Kortix Tunnel. On macOS, use the app name (e.g., "Calculator", "Safari"). On Linux, use the executable name or desktop file.`,
	args: {
		tunnel_id: tunnelIdArg,
		app: tool.schema.string().describe("Application name to launch"),
	},
	async execute(args) {
		const tunnelId = await resolveTunnelId(args)
		const result = await tunnelRpc(tunnelId, "desktop.app.launch", { app: args.app })
		if (typeof result === "string") return result
		return `Launched: ${args.app}`
	},
})

export const tunnelAppQuitTool = tool({
	description: `Quit an application on the user's machine via Kortix Tunnel.`,
	args: {
		tunnel_id: tunnelIdArg,
		app: tool.schema.string().describe("Application name to quit"),
	},
	async execute(args) {
		const tunnelId = await resolveTunnelId(args)
		const result = await tunnelRpc(tunnelId, "desktop.app.quit", { app: args.app })
		if (typeof result === "string") return result
		return `Quit: ${args.app}`
	},
})

export const tunnelClipboardReadTool = tool({
	description: `Read the clipboard contents from the user's machine via Kortix Tunnel.`,
	args: {
		tunnel_id: tunnelIdArg,
	},
	async execute(args) {
		const tunnelId = await resolveTunnelId(args)
		const result = await tunnelRpc(tunnelId, "desktop.clipboard.read", {})
		if (typeof result === "string") return result

		const data = result as { text: string }
		if (!data.text) return "(clipboard is empty)"
		return `=== Clipboard ===\n${data.text}`
	},
})

export const tunnelClipboardWriteTool = tool({
	description: `Write text to the clipboard on the user's machine via Kortix Tunnel.`,
	args: {
		tunnel_id: tunnelIdArg,
		text: tool.schema.string().describe("Text to write to clipboard"),
	},
	async execute(args) {
		const tunnelId = await resolveTunnelId(args)
		const result = await tunnelRpc(tunnelId, "desktop.clipboard.write", { text: args.text })
		if (typeof result === "string") return result
		return `Clipboard updated (${args.text.length} chars)`
	},
})

export const tunnelCursorImageTool = tool({
	description: `Take a small screenshot around the current cursor position on the user's machine via Kortix Tunnel. Saves the image to a temp file and returns the path. Use the Read tool on the returned path to view the image.`,
	args: {
		tunnel_id: tunnelIdArg,
		radius: tool.schema.number().optional().describe("Radius in pixels around cursor (default: 50)"),
	},
	async execute(args) {
		const tunnelId = await resolveTunnelId(args)
		const result = await tunnelRpc(tunnelId, "desktop.cursor.image", { radius: args.radius })
		if (typeof result === "string") return result

		const data = result as { image: string; width: number; height: number; format?: string }
		const format = data.format || "png"
		const sizeKB = Math.round(data.image.length * 0.75 / 1024)
		const path = saveImage(data.image, format)
		return `Cursor area saved: ${path}\nDimensions: ${data.width}x${data.height} ${format.toUpperCase()} (${sizeKB}KB)\n\nUse the Read tool to view this image.`
	},
})

export const tunnelMouseMoveTool = tool({
	description: `Move the mouse cursor to a specific position on the user's screen via Kortix Tunnel.`,
	args: {
		tunnel_id: tunnelIdArg,
		x: tool.schema.number().describe("Target X coordinate"),
		y: tool.schema.number().describe("Target Y coordinate"),
	},
	async execute(args) {
		const tunnelId = await resolveTunnelId(args)
		const result = await tunnelRpc(tunnelId, "desktop.mouse.move", { x: args.x, y: args.y })
		if (typeof result === "string") return result
		return `Mouse moved to (${args.x}, ${args.y})`
	},
})

export const tunnelMouseDragTool = tool({
	description: `Drag from one point to another on the user's screen via Kortix Tunnel. Useful for drag-and-drop, resizing, or drawing.`,
	args: {
		tunnel_id: tunnelIdArg,
		fromX: tool.schema.number().describe("Start X coordinate"),
		fromY: tool.schema.number().describe("Start Y coordinate"),
		toX: tool.schema.number().describe("End X coordinate"),
		toY: tool.schema.number().describe("End Y coordinate"),
		button: tool.schema.enum(["left", "right"]).optional().describe("Mouse button (default: left)"),
	},
	async execute(args) {
		const tunnelId = await resolveTunnelId(args)
		const result = await tunnelRpc(tunnelId, "desktop.mouse.drag", {
			fromX: args.fromX,
			fromY: args.fromY,
			toX: args.toX,
			toY: args.toY,
			button: args.button,
		})
		if (typeof result === "string") return result
		return `Dragged from (${args.fromX}, ${args.fromY}) to (${args.toX}, ${args.toY})`
	},
})

export const tunnelMouseScrollTool = tool({
	description: `Scroll the mouse wheel at a specific position on the user's screen via Kortix Tunnel.`,
	args: {
		tunnel_id: tunnelIdArg,
		x: tool.schema.number().describe("X coordinate to scroll at"),
		y: tool.schema.number().describe("Y coordinate to scroll at"),
		deltaX: tool.schema.number().optional().describe("Horizontal scroll amount (positive=right)"),
		deltaY: tool.schema.number().optional().describe("Vertical scroll amount (positive=down)"),
	},
	async execute(args) {
		const tunnelId = await resolveTunnelId(args)
		const result = await tunnelRpc(tunnelId, "desktop.mouse.scroll", {
			x: args.x,
			y: args.y,
			deltaX: args.deltaX,
			deltaY: args.deltaY,
		})
		if (typeof result === "string") return result
		return `Scrolled at (${args.x}, ${args.y}) [dx=${args.deltaX || 0}, dy=${args.deltaY || 0}]`
	},
})

export const tunnelScreenInfoTool = tool({
	description: `Get screen resolution and scale factor from the user's machine via Kortix Tunnel.`,
	args: {
		tunnel_id: tunnelIdArg,
	},
	async execute(args) {
		const tunnelId = await resolveTunnelId(args)
		const result = await tunnelRpc(tunnelId, "desktop.screen.info", {})
		if (typeof result === "string") return result

		const data = result as { width: number; height: number; scaleFactor: number }
		return `Screen: ${data.width}x${data.height} @ ${data.scaleFactor}x scale`
	},
})

// ─── Accessibility Tree Tools ─────────────────────────────────────────────────

interface AXElement {
	id: string
	role: string
	title: string
	value: string
	description: string
	bounds: { x: number; y: number; width: number; height: number }
	children: AXElement[]
	actions: string[]
	enabled: boolean
	focused: boolean
}

function formatAXTree(el: AXElement, indent: number = 0): string {
	const pad = "  ".repeat(indent)
	const parts: string[] = []

	const label = el.title || el.value || el.description || "(unnamed)"
	const flags: string[] = []
	if (!el.enabled) flags.push("disabled")
	if (el.focused) flags.push("focused")
	if (el.actions.length > 0) flags.push(`actions: ${el.actions.join(",")}`)
	const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : ""

	parts.push(`${pad}[${el.role}] ${label} (id: ${el.id})${flagStr}`)

	for (const child of el.children) {
		parts.push(formatAXTree(child, indent + 1))
	}

	return parts.join("\n")
}

export const tunnelAxTreeTool = tool({
	description: `Get the accessibility tree of an application on the user's machine via Kortix Tunnel. Returns a structured tree of UI elements with roles, labels, states, and available actions. Much faster and cheaper than screenshots for understanding UI state. Use pid to target a specific application.`,
	args: {
		tunnel_id: tunnelIdArg,
		pid: tool.schema.number().optional().describe("Process ID of the target application (omit for all apps)"),
		maxDepth: tool.schema.number().optional().describe("Maximum tree depth (default: 8)"),
		roles: tool.schema.array(tool.schema.string()).optional().describe("Filter by element roles (e.g., ['button', 'textfield'])"),
	},
	async execute(args) {
		const tunnelId = await resolveTunnelId(args)
		const params: Record<string, unknown> = {}
		if (args.pid !== undefined) params.pid = args.pid
		if (args.maxDepth !== undefined) params.maxDepth = args.maxDepth
		if (args.roles !== undefined) params.roles = args.roles

		const result = await tunnelRpc(tunnelId, "desktop.ax.tree", params)
		if (typeof result === "string") return result

		const data = result as { root: AXElement; elementCount: number }
		if (!data.root) return "No accessibility tree available"

		const tree = formatAXTree(data.root)
		return `=== Accessibility Tree (${data.elementCount} elements) ===\n${tree}`
	},
})

export const tunnelAxActionTool = tool({
	description: `Perform an accessibility action on a UI element via Kortix Tunnel. Returns before/after state to verify the action actually worked. Use tunnel_ax_tree first to discover element IDs and available actions. Common actions: AXPress, AXConfirm, AXCancel, AXRaise, AXShowMenu. Check stateChanged in the response to verify success.`,
	args: {
		tunnel_id: tunnelIdArg,
		elementId: tool.schema.string().describe("Element ID from the accessibility tree (e.g., '0.3.1')"),
		action: tool.schema.string().describe("Action to perform: AXPress, AXConfirm, AXCancel, AXRaise, AXShowMenu"),
		pid: tool.schema.number().optional().describe("Process ID of the target application"),
	},
	async execute(args) {
		const tunnelId = await resolveTunnelId(args)
		const result = await tunnelRpc(tunnelId, "desktop.ax.action", {
			elementId: args.elementId,
			action: args.action,
			pid: args.pid,
		})
		if (typeof result === "string") return result

		const data = result as {
			ok: boolean; action: string; elementId: string;
			before: { focused: boolean; value: string };
			after: { focused: boolean; value: string };
			stateChanged: boolean; role: string; title: string;
		}

		const lines = [`Action "${data.action}" on [${data.role}] "${data.title}" (${data.elementId})`]
		lines.push(`State changed: ${data.stateChanged ? "YES" : "NO"}`)
		lines.push(`Before: focused=${data.before.focused}, value="${data.before.value}"`)
		lines.push(`After:  focused=${data.after.focused}, value="${data.after.value}"`)
		if (!data.stateChanged) {
			lines.push(`WARNING: No state change detected. The action may not have had any effect.`)
		}
		return lines.join("\n")
	},
})

export const tunnelAxSetValueTool = tool({
	description: `Directly set the value of a UI element (text field, search box, etc.) via the accessibility API. Much more reliable than clicking and typing. Verifies the value was actually set by reading it back. Use tunnel_ax_tree to find element IDs.`,
	args: {
		tunnel_id: tunnelIdArg,
		elementId: tool.schema.string().describe("Element ID from the accessibility tree (e.g., '0.3.1')"),
		value: tool.schema.string().describe("The value to set (e.g., text to put in a search field)"),
		pid: tool.schema.number().optional().describe("Process ID of the target application"),
	},
	async execute(args) {
		const tunnelId = await resolveTunnelId(args)
		const result = await tunnelRpc(tunnelId, "desktop.ax.set_value", {
			elementId: args.elementId,
			value: args.value,
			pid: args.pid,
		})
		if (typeof result === "string") return result

		const data = result as {
			ok: boolean; elementId: string;
			requestedValue: string; actualValue: string; error?: string;
		}

		if (data.ok) {
			return `Value set successfully on ${data.elementId}\nRequested: "${data.requestedValue}"\nVerified:  "${data.actualValue}"`
		} else {
			return `FAILED to set value on ${data.elementId}\nRequested: "${data.requestedValue}"\nActual:    "${data.actualValue}"\nError: ${data.error || "unknown"}`
		}
	},
})

export const tunnelAxFocusTool = tool({
	description: `Focus a UI element directly via the accessibility API. More reliable than clicking to focus. Verifies focus was actually set. Use tunnel_ax_tree to find element IDs.`,
	args: {
		tunnel_id: tunnelIdArg,
		elementId: tool.schema.string().describe("Element ID from the accessibility tree (e.g., '0.3.1')"),
		pid: tool.schema.number().optional().describe("Process ID of the target application"),
	},
	async execute(args) {
		const tunnelId = await resolveTunnelId(args)
		const result = await tunnelRpc(tunnelId, "desktop.ax.focus", {
			elementId: args.elementId,
			pid: args.pid,
		})
		if (typeof result === "string") return result

		const data = result as {
			ok: boolean; elementId: string; role: string; title: string;
			before: { focused: boolean }; after: { focused: boolean }; error?: string;
		}

		if (data.ok) {
			return `Focused [${data.role}] "${data.title}" (${data.elementId})\nBefore: focused=${data.before.focused}\nAfter:  focused=${data.after.focused}`
		} else {
			return `FAILED to focus [${data.role}] "${data.title}" (${data.elementId})\nError: ${data.error || "unknown"}\nBefore: focused=${data.before.focused}\nAfter:  focused=${data.after.focused}`
		}
	},
})

export const tunnelAxSearchTool = tool({
	description: `Search the accessibility tree for UI elements matching a query via Kortix Tunnel. Performs case-insensitive substring match on element titles, values, and descriptions. Faster than walking the full tree when you know what you're looking for.`,
	args: {
		tunnel_id: tunnelIdArg,
		query: tool.schema.string().describe("Search text (matches against title, value, description)"),
		role: tool.schema.string().optional().describe("Filter by element role (e.g., 'button', 'textfield')"),
		pid: tool.schema.number().optional().describe("Process ID of the target application"),
		maxResults: tool.schema.number().optional().describe("Maximum results to return (default: 20)"),
	},
	async execute(args) {
		const tunnelId = await resolveTunnelId(args)
		const params: Record<string, unknown> = { query: args.query }
		if (args.role !== undefined) params.role = args.role
		if (args.pid !== undefined) params.pid = args.pid
		if (args.maxResults !== undefined) params.maxResults = args.maxResults

		const result = await tunnelRpc(tunnelId, "desktop.ax.search", params)
		if (typeof result === "string") return result

		const data = result as { elements: AXElement[] }
		if (!data.elements || data.elements.length === 0) return `No elements found matching "${args.query}"`

		const lines = [`=== AX Search: "${args.query}" (${data.elements.length} results) ===`]
		for (const el of data.elements) {
			const label = el.title || el.value || el.description || "(unnamed)"
			const flags: string[] = []
			if (!el.enabled) flags.push("disabled")
			if (el.focused) flags.push("focused")
			if (el.actions.length > 0) flags.push(`actions: ${el.actions.join(",")}`)
			const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : ""
			const b = el.bounds
			lines.push(`  [${el.role}] ${label} (id: ${el.id}) @ ${b.x},${b.y} ${b.width}x${b.height}${flagStr}`)
		}
		return lines.join("\n")
	},
})
