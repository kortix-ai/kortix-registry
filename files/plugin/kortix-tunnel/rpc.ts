/**
 * Shared RPC infrastructure for tunnel tools.
 *
 * Auth: KORTIX_API_URL + KORTIX_TOKEN via the shared getEnv() helper.
 * Resolution order: process.env → s6 env dir → .env file fallback.
 */

import { getEnv } from "../../tools/lib/get-env"

export function getApiBase(): string {
	return (getEnv("KORTIX_API_URL") || "http://localhost:8008").replace(/\/+$/, "")
}

export function getTunnelBase(): string {
	return `${getApiBase()}/v1/tunnel`
}

export function getToken(): string {
	return getEnv("KORTIX_TOKEN") || ""
}

// ─── Tunnel RPC ─────────────────────────────────────────────────────────────

export async function tunnelRpc(
	tunnelId: string,
	method: string,
	params: Record<string, unknown>,
): Promise<unknown> {
	const token = getToken()

	const res = await fetch(`${getTunnelBase()}/rpc/${tunnelId}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify({ method, params }),
	})

	const data = (await res.json()) as Record<string, unknown>

	if (!res.ok) {
		if (res.status === 404) cachedTunnelId = null

		if (res.status === 403 && data.requestId) {
			return `Permission required. A permission request (${data.requestId}) has been sent to the user for approval. The user needs to approve this request in the Kortix dashboard before you can access their local machine. Please inform the user and try again after they approve.`
		}

		throw new Error(`Tunnel RPC failed: ${data.error || `HTTP ${res.status}`} (code: ${data.code || -1})`)
	}

	return data.result
}

// ─── Tunnel ID resolution ───────────────────────────────────────────────────

let cachedTunnelId: string | null = null

export async function resolveTunnelId(args: { tunnel_id?: string }): Promise<string> {
	if (args.tunnel_id) return args.tunnel_id
	if (getEnv("KORTIX_TUNNEL_ID")) return getEnv("KORTIX_TUNNEL_ID")!
	if (cachedTunnelId) return cachedTunnelId

	// Auto-discover via API
	const token = getToken()

	try {
		const res = await fetch(`${getTunnelBase()}/connections`, {
			headers: {
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
		})
		if (res.ok) {
			const connections = (await res.json()) as Array<{ tunnelId: string; isLive: boolean }>
			const online = connections.find((c) => c.isLive)
			if (online) { cachedTunnelId = online.tunnelId; return online.tunnelId }
			if (connections.length > 0) { cachedTunnelId = connections[0].tunnelId; return connections[0].tunnelId }
		}
	} catch {}

	throw new Error(
		"No tunnel connection found. The user needs to set up Kortix Tunnel first:\n" +
		"1. Go to the Tunnel page in Kortix dashboard\n" +
		"2. Create a new connection\n" +
		"3. Run `npx @kortix/tunnel connect` on their local machine"
	)
}
