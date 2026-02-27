/**
 * Kortix Tunnel Plugin — standalone OpenCode plugin that registers
 * all tunnel tools for interacting with the user's local machine.
 */

import type { Plugin } from "@opencode-ai/plugin"
import { tunnelStatusTool, tunnelFsReadTool, tunnelFsWriteTool, tunnelFsListTool, tunnelShellExecTool } from "./tunnel"
import {
	tunnelScreenshotTool,
	tunnelClickTool,
	tunnelTypeTool,
	tunnelKeyTool,
	tunnelWindowListTool,
	tunnelWindowFocusTool,
	tunnelAppLaunchTool,
	tunnelAppQuitTool,
	tunnelClipboardReadTool,
	tunnelClipboardWriteTool,
	tunnelCursorImageTool,
	tunnelMouseMoveTool,
	tunnelMouseDragTool,
	tunnelMouseScrollTool,
	tunnelScreenInfoTool,
	tunnelAxTreeTool,
	tunnelAxActionTool,
	tunnelAxSetValueTool,
	tunnelAxFocusTool,
	tunnelAxSearchTool,
} from "./tunnel-desktop"

const TunnelPlugin: Plugin = async () => ({
	tool: {
		// Core
		tunnel_status: tunnelStatusTool,
		tunnel_fs_read: tunnelFsReadTool,
		tunnel_fs_write: tunnelFsWriteTool,
		tunnel_fs_list: tunnelFsListTool,
		tunnel_shell_exec: tunnelShellExecTool,
		// Desktop
		tunnel_screenshot: tunnelScreenshotTool,
		tunnel_click: tunnelClickTool,
		tunnel_type: tunnelTypeTool,
		tunnel_key: tunnelKeyTool,
		tunnel_window_list: tunnelWindowListTool,
		tunnel_window_focus: tunnelWindowFocusTool,
		tunnel_app_launch: tunnelAppLaunchTool,
		tunnel_app_quit: tunnelAppQuitTool,
		tunnel_clipboard_read: tunnelClipboardReadTool,
		tunnel_clipboard_write: tunnelClipboardWriteTool,
		tunnel_cursor_image: tunnelCursorImageTool,
		tunnel_mouse_move: tunnelMouseMoveTool,
		tunnel_mouse_drag: tunnelMouseDragTool,
		tunnel_mouse_scroll: tunnelMouseScrollTool,
		tunnel_screen_info: tunnelScreenInfoTool,
		// Accessibility
		tunnel_ax_tree: tunnelAxTreeTool,
		tunnel_ax_action: tunnelAxActionTool,
		tunnel_ax_set_value: tunnelAxSetValueTool,
		tunnel_ax_focus: tunnelAxFocusTool,
		tunnel_ax_search: tunnelAxSearchTool,
	},
})

export default TunnelPlugin
