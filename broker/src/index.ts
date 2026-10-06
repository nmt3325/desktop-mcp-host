import { createMcpHandler } from "agents/mcp/server"
import { loadConfig } from "./config"
import { SERVER_INFO, serverFactory } from "./mcp"
import { Deadline, POLL_MIN_MS, isJsonPayload, makePollClock, sleep } from "./result"
import { buildTools, type Bindings } from "./tools"
import { guard, platformOf } from "./tools-shared"

export { EnvDO } from "./env-do"
export { GuardDO } from "./guard-do"

/*
 * Command dispatch latency is what the model feels on every exec, so /next
 * probes the queue on a tighter ceiling than /control, where the thing being
 * waited for is a kill or a destroy that can tolerate another second or two.
 */
const NEXT_POLL_MAX_MS = 2_500

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false
	let diff = 0
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
	return diff === 0
}

function bearer(request: Request): string {
	const h = request.headers.get("authorization") || ""
	return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : ""
}

async function hmacHex(secret: string, message: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	)
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message))
	return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

export default {
	async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url)
		const cfg = loadConfig(env as Record<string, unknown>)

		if (url.pathname === "/healthz") {
			return json({ ok: true, server: SERVER_INFO, mode: "local-host" })
		}

		/*
		 * Diagnostic endpoint for measuring how long an outbound local-agent
		 * connection survives through the deployed proxy path.
		 */
		if (url.pathname === "/probe") {
			const wait = Math.min(70, Math.max(0, Number(url.searchParams.get("wait") || "0")))
			const startedAt = Date.now()
			await sleep(wait * 1000)
			return json({ ok: true, waited_s: wait, held_ms: Date.now() - startedAt })
		}

		/* ------------------------------------------------------------- MCP lane */
		if (url.pathname === "/mcp") {
			const expected = String(env.MCP_AUTH_TOKEN || "")
			// The two auth lanes never cross-accept: an agent token must never open
			// the MCP surface, and MCP_AUTH_TOKEN must never drive /agent/*.
			if (!expected || !timingSafeEqual(bearer(request), expected)) {
				return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "unauthorized" } }, 401)
			}

			// Built per request because the tool list closes over these bindings and
			// this config. responseMode is deliberately left at its default: JSON
			// mode drops notifications emitted before a final result, and those
			// notifications are the progress heartbeat that lets a client wait past
			// the 60s protocol default.
			const handler = createMcpHandler(serverFactory(buildTools(env, cfg)), { route: "/mcp" })
			return handler(request, env, ctx)
		}

		/* ----------------------------------------------------------- agent lane */
		const agent = /^\/agent\/([^/]+)\/(hello|control|next|chunk)$/.exec(url.pathname)
		if (agent) {
			const envId = decodeURIComponent(agent[1])
			const action = agent[2]

			if (action === "hello") {
				const nonce = request.headers.get("x-nonce") || ""
				const ts = Number(request.headers.get("x-ts") || "0")
				const sig = request.headers.get("x-sig") || ""
				const secret = String(env.BROKER_SECRET || "")
				if (!secret) return json({ ok: false, reason: "BROKER_SECRET is not configured" }, 500)

				if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
					return json({ ok: false, reason: "timestamp outside the +/-300s window" }, 401)
				}
				const expect = await hmacHex(secret, [envId, nonce, String(ts)].join("\n"))
				if (!timingSafeEqual(sig, expect)) return json({ ok: false, reason: "bad signature" }, 401)

				let facts: Record<string, unknown> = {}
				try {
					facts = (await request.json()) as Record<string, unknown>
				} catch {
					facts = {}
				}

				// Do not allocate per-device storage until the shared-secret HMAC has
				// been verified. Otherwise arbitrary callers could create unbounded
				// SQLite files by probing valid-looking device IDs.
				const stub = env.ENV_DO.get(env.ENV_DO.idFromName(envId)) as any
				const platform = platformOf(envId)
				const deviceName =
					typeof facts.device_name === "string" && facts.device_name.trim()
						? facts.device_name.trim().slice(0, 128)
						: envId

				await stub.provisionHost({ envId, platform, label: deviceName })

				const r = await stub.enroll({
					facts,
					execWorkers: cfg.execWorkers,
					redact: [],
				})
				if (!r.ok) return json(r, 409)
				await guard(env).registerDevice({ envId, name: deviceName, platform, metadata: facts })
				return json(r)
			}

			const stub = env.ENV_DO.get(env.ENV_DO.idFromName(envId)) as any
			const auth = await stub.authAgent(bearer(request))
			if (!auth.ok) return json({ ok: false, reason: auth.reason }, auth.status || 401)
			await guard(env).touchDevice(envId)

			if (action === "control") {
				let body: any = {}
				try {
					body = await request.json()
				} catch {
					body = {}
				}
				// Drain actions immediately, then park. The hanging request is held
				// here in the stateless frontend, never inside the Durable Object.
				const first = await stub.controlPoll(body)
				if (first.actions.length) return json(first)

				const waitS = Math.min(cfg.agentWaitSeconds, Math.max(1, Number(body.wait) || cfg.agentWaitSeconds))

				// Holding the request costs nothing -- Workers bill per request, not per
				// second parked -- but every probe inside the hold is a billed Durable
				// Object request. At a flat 1s cadence, learning that nothing happened
				// cost 22 requests per park, which is how two idle long-polls per
				// environment reached 106,857 DO requests in a single day against a
				// 100,000/day ceiling. The park still lasts as long as the runner asked
				// for; only the probing relaxes.
				const dl = new Deadline(waitS * 1000, request.signal)
				const clock = makePollClock()
				while (await dl.tick(clock.next())) {
					if (await stub.hasActions()) {
						return json(await stub.controlPoll(body))
					}
				}

				if (dl.aborted) return json({ actions: [] })
				return json(await stub.controlPoll(body))
			}

			if (action === "next") {
				const waitS = Math.min(
					cfg.agentWaitSeconds,
					Math.max(1, Number(url.searchParams.get("wait")) || cfg.agentWaitSeconds),
				)
				const worker = url.searchParams.get("worker") || "0"
				const dl = new Deadline(waitS * 1000, request.signal)
				const clock = makePollClock(POLL_MIN_MS, NEXT_POLL_MAX_MS)
				for (;;) {
					const r = await stub.claimNext(worker)
					if (r.command) return json({ command: r.command })
					// A claim is a write, so an aborted request must not start another
					// one: the job would be handed to a worker that has already gone
					// away and would have to time out as `lost`.
					if (!(await dl.tick(clock.next()))) return json({ command: null })
				}
			}

			if (action === "chunk") {
				const text = await request.text()
				if (!isJsonPayload(request.headers.get("content-type"), text)) {
					return json({ ok: false, reason: "expected a JSON body" }, 400)
				}
				let body: any
				try {
					body = JSON.parse(text)
				} catch {
					return json({ ok: false, reason: "malformed JSON" }, 400)
				}
				return json(await stub.ingestChunk(body))
			}
		}

		return json({ ok: false, error: "not found" }, 404)
	},
}
