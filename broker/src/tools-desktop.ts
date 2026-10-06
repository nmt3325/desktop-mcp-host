import { z } from "zod"
import type { BrokerConfig, Platform } from "./config"
import type { ToolDef } from "./mcp"
import { fail, ok } from "./result"
import { buildRunTools } from "./tools-run"
import { type Bindings, envStub, guard, platformOf } from "./tools-shared"

const ONLINE_MS = 120_000

async function chooseDevice(env: Bindings, requested?: string) {
	const rows = await guard(env).listDevices()
	const enriched = rows.map((d: any) => ({
		...d,
		online: Date.now() - Number(d.last_seen || 0) < ONLINE_MS,
	}))
	if (requested) {
		const found = enriched.find((d: any) => d.env_id === requested)
		if (!found) return { error: fail("env_not_found", `no device ${requested}`, { next_action: "list_devices" }) }
		return { device: found }
	}
	const online = enriched.filter((d: any) => d.online)
	if (online.length === 1) return { device: online[0] }
	if (online.length === 0) {
		return { error: fail("env_not_found", "no registered device is online", { next_action: "list_devices" }) }
	}
	return {
		error: fail("bad_input", "more than one device is online; pass deviceId", {
			extra: { device_ids: online.map((d: any) => d.env_id) },
			next_action: "list_devices",
		}),
	}
}

function shellArgv(platform: Platform, command: string): string[] {
	return platform === "windows"
		? ["pwsh", "-NoProfile", "-Command", command]
		: ["bash", "-lc", command]
}

export function buildDesktopTools(env: Bindings, cfg: BrokerConfig): ToolDef[] {
	const runTools = buildRunTools(env, cfg)
	const execute = runTools.find((t) => t.name === "execute")!
	const poll = runTools.find((t) => t.name === "poll_job")!
	const stop = runTools.find((t) => t.name === "stop_job")!

	const DeviceField = z.string().optional().describe("Device ID from list_devices. Optional when exactly one device is online.")

	const listDevices: ToolDef = {
		name: "list_devices",
		title: "List computers",
		description: "Desktop Commander-compatible device discovery for persistent local agents.",
		inputSchema: z.strictObject({}),
		readOnly: true,
		async handler() {
			const rows = await guard(env).listDevices()
			const devices = []
			for (const d of rows) {
				const snap = await envStub(env, d.env_id).snapshot(false)
				const lastSeenMsAgo = Math.max(0, Date.now() - Number(d.last_seen || 0))
				devices.push({
					id: d.env_id,
					deviceId: d.env_id,
					name: d.name,
					platform: d.platform,
					status: lastSeenMsAgo < ONLINE_MS ? "Online" : "Offline",
					online: lastSeenMsAgo < ONLINE_MS,
					last_seen_ms_ago: lastSeenMsAgo,
					state: snap?.state ?? "lost",
				})
			}
			return ok({ devices })
		},
	}

	const whoAmI: ToolDef = {
		name: "who_am_i",
		title: "Show broker identity",
		description: "Report the local-agent broker mode and registered device counts.",
		inputSchema: z.strictObject({}),
		readOnly: true,
		async handler() {
			const rows = await guard(env).listDevices()
			const online = rows.filter((d: any) => Date.now() - Number(d.last_seen || 0) < ONLINE_MS)
			return ok({
				selfHosted: true,
				mode: "persistent-local-agent",
				registeredDevices: rows.length,
				onlineDevices: online.length,
				monthlyLimit: null,
			})
		},
	}

	const ping: ToolDef = {
		name: "ping",
		title: "Ping a computer",
		description: "Check whether a registered local agent is currently online.",
		inputSchema: z.strictObject({ deviceId: DeviceField }),
		readOnly: true,
		async handler(args: any) {
			const picked = await chooseDevice(env, args.deviceId)
			if (picked.error) return picked.error
			const d: any = picked.device
			const age = Math.max(0, Date.now() - Number(d.last_seen || 0))
			if (age >= ONLINE_MS) return fail("broker_unreachable", `device ${d.env_id} is offline`, { retry_after_ms: 5000 })
			return ok({ pong: true, deviceId: d.env_id, name: d.name, last_seen_ms_ago: age })
		},
	}

	const getConfig: ToolDef = {
		name: "get_config",
		title: "Get computer configuration",
		description: "Desktop Commander-style configuration and machine facts for one local agent.",
		inputSchema: z.strictObject({ deviceId: DeviceField }),
		readOnly: true,
		async handler(args: any) {
			const picked = await chooseDevice(env, args.deviceId)
			if (picked.error) return picked.error
			const d: any = picked.device
			const snap = await envStub(env, d.env_id).snapshot(true)
			return ok({
				deviceId: d.env_id,
				name: d.name,
				platform: d.platform,
				online: Date.now() - Number(d.last_seen || 0) < ONLINE_MS,
				defaultShell: snap?.facts?.shell_default ?? null,
				allowedDirectories: [],
				blockedCommands: [],
				systemInfo: snap?.facts ?? {},
				stickyCwd: snap?.sticky_cwd ?? null,
			})
		},
	}

	const startProcess: ToolDef = {
		name: "start_process",
		title: "Start a process",
		description:
			"Desktop Commander-compatible command entry point. Runs through the local agent and returns a persistent job/session id that read_process_output can resume.",
		inputSchema: z.strictObject({
			command: z.string().min(1),
			deviceId: DeviceField,
			timeout_ms: z.number().optional(),
		}),
		async handler(args: any, ctx) {
			const picked = await chooseDevice(env, args.deviceId)
			if (picked.error) return picked.error
			const d: any = picked.device
			const waitMs = Math.max(1000, Math.min(Number(args.timeout_ms ?? 3000), 45_000))
			const result: any = await execute.handler(
				{
					env_id: d.env_id,
					command: shellArgv(platformOf(d.env_id), args.command),
					wait_ms: waitMs,
					allow_duplicate: true,
					label: "start_process",
				},
				ctx,
			)
			return {
				...result,
				pid: result.job_id ?? null,
				session_id: result.job_id ?? null,
				deviceId: d.env_id,
			}
		},
	}

	const readProcessOutput: ToolDef = {
		name: "read_process_output",
		title: "Read process output",
		description: "Read or wait for output from a process started by start_process.",
		inputSchema: z.strictObject({
			pid: z.union([z.string(), z.number()]),
			deviceId: DeviceField,
			offset: z.number().optional(),
			length: z.number().optional(),
			timeout_ms: z.number().optional(),
		}),
		readOnly: true,
		async handler(args: any, ctx) {
			const picked = await chooseDevice(env, args.deviceId)
			if (picked.error) return picked.error
			const d: any = picked.device
			const result: any = await poll.handler(
				{
					env_id: d.env_id,
					job_id: String(args.pid),
					from_byte: Math.max(0, Number(args.offset ?? 0)),
					max_bytes: Math.max(1024, Math.min(Number(args.length ?? 65536), 262144)),
					wait_ms: Math.max(0, Math.min(Number(args.timeout_ms ?? 1000), 45000)),
					until: "any_output",
				},
				ctx,
			)
			return { ...result, pid: String(args.pid), deviceId: d.env_id }
		},
	}

	const forceTerminate: ToolDef = {
		name: "force_terminate",
		title: "Terminate a process",
		description: "Terminate a process/session started by start_process.",
		inputSchema: z.strictObject({
			pid: z.union([z.string(), z.number()]),
			deviceId: DeviceField,
		}),
		async handler(args: any, ctx) {
			const picked = await chooseDevice(env, args.deviceId)
			if (picked.error) return picked.error
			const d: any = picked.device
			return stop.handler({ env_id: d.env_id, job_id: String(args.pid), signal: "KILL" }, ctx)
		},
	}

	const listSessions: ToolDef = {
		name: "list_sessions",
		title: "List recent process sessions",
		description: "Show recent jobs/process sessions on one local computer.",
		inputSchema: z.strictObject({ deviceId: DeviceField }),
		readOnly: true,
		async handler(args: any) {
			const picked = await chooseDevice(env, args.deviceId)
			if (picked.error) return picked.error
			const d: any = picked.device
			const snap = await envStub(env, d.env_id).snapshot(true)
			return ok({
				deviceId: d.env_id,
				sessions: snap?.commands ?? [],
				queue_depth: snap?.queue_depth ?? 0,
			})
		},
	}

	return [listDevices, whoAmI, ping, getConfig, startProcess, readProcessOutput, forceTerminate, listSessions]
}
