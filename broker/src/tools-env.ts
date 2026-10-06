import { BASE64_RECIPES, type BrokerConfig } from "./config"
import type { ToolDef } from "./mcp"
import { Deadline, SOFT_CAP_MS, clamp, fail, numArg, ok } from "./result"
import {
	EnvDestroyInput,
	EnvListInput,
	EnvStatusInput,
	envCreateInput,
	envExtendInput,
	type EnvCreateArgs,
	type EnvDestroyArgs,
	type EnvExtendArgs,
	type EnvStatusArgs,
} from "./schemas"
import { type Bindings, envStub, guard, platformOf } from "./tools-shared"

const ONLINE_MS = 120_000

export function buildEnvTools(env: Bindings, cfg: BrokerConfig): ToolDef[] {
	const envCreate: ToolDef = {
		name: "env_create",
		title: "Register a local computer",
		description:
			"Local mode does not provision GitHub Actions runners. Computers register themselves by running agent.mjs with BROKER_URL and BROKER_SECRET. " +
			"Use env_list or list_devices to see registered computers.",
		inputSchema: envCreateInput(cfg),
		async handler(_args: EnvCreateArgs) {
			return fail("local_agent_required", "env_create no longer dispatches GitHub Actions", {
				hint:
					"Install and start the local agent on the computer you want to control. It will register itself and remain available across MCP sessions.",
				next_action: "env_list",
			})
		},
	}

	const envStatus: ToolDef = {
		name: "env_status",
		title: "Inspect one computer",
		description:
			"State, last contact, working directory, queue depth, recent commands and runner facts for one registered computer.",
		inputSchema: EnvStatusInput,
		readOnly: true,
		async handler(args: EnvStatusArgs, ctx) {
			const envId = args.env_id
			const stub = envStub(env, envId)
			const verbose = Boolean(args.verbose)
			let snap = await stub.snapshot(verbose)
			if (!snap.env_id) return fail("env_not_found", `no computer ${envId}`, { next_action: "env_list" })

			const waitMs = clamp(numArg(args.wait_ready_ms, 0), 0, SOFT_CAP_MS)
			if (waitMs > 0) {
				const dl = new Deadline(waitMs, ctx.signal)
				while (snap.state === "provisioning" && (await dl.tick(1000))) {
					ctx.note("waiting for the local agent to enroll")
					snap = await stub.snapshot(verbose)
				}
			}
			const platform = platformOf(envId)
			return ok({
				...snap,
				online: Number(snap.last_seen_ms_ago ?? Number.MAX_SAFE_INTEGER) < ONLINE_MS,
				base64_recipes: verbose ? BASE64_RECIPES[platform] : undefined,
			})
		},
	}

	const envList: ToolDef = {
		name: "env_list",
		title: "List registered computers",
		description:
			"List computers whose persistent local agents have registered with this broker. A computer is considered online when it contacted the broker in the last two minutes.",
		inputSchema: EnvListInput,
		readOnly: true,
		async handler() {
			const rows = await guard(env).listDevices()
			const environments = []
			for (const d of rows) {
				const snap = await envStub(env, d.env_id).snapshot(false)
				const lastSeenMsAgo = Math.max(0, Date.now() - Number(d.last_seen || 0))
				environments.push({
					env_id: d.env_id,
					device_id: d.env_id,
					name: d.name,
					platform: d.platform,
					state: snap?.state ?? "lost",
					online: lastSeenMsAgo < ONLINE_MS,
					last_seen_ms_ago: lastSeenMsAgo,
					registered_at: d.registered_at,
					queue_depth: snap?.queue_depth ?? null,
					sticky_cwd: snap?.sticky_cwd ?? null,
				})
			}
			return ok({
				environments,
				count: environments.length,
				online_count: environments.filter((d) => d.online).length,
			})
		},
	}

	const envDestroy: ToolDef = {
		name: "env_destroy",
		title: "Disconnect a computer",
		description:
			"Ask a registered local agent to stop and remove it from the broker registry. A service manager may reconnect it if the agent service is configured to restart.",
		inputSchema: EnvDestroyInput,
		async handler(args: EnvDestroyArgs) {
			const envId = args.env_id
			const stub = envStub(env, envId)
			const snap = await stub.snapshot(false)
			if (!snap.env_id) return fail("env_not_found", `no computer ${envId}`, { next_action: "env_list" })
			await stub.markDestroying()
			await guard(env).removeDevice(envId)
			return ok({
				env_id: envId,
				device_id: envId,
				destroyed: true,
				note: "the broker requested agent shutdown; disable its service if you do not want it to reconnect",
			})
		},
	}

	const envExtend: ToolDef = {
		name: "env_extend",
		title: "Extend an ephemeral lease",
		description:
			"Compatibility tool for old ephemeral agents. Persistent local agents do not expire and do not need this.",
		inputSchema: envExtendInput(cfg),
		async handler(args: EnvExtendArgs) {
			const envId = args.env_id
			const minutes = clamp(numArg(args.minutes, 30), 1, cfg.maxTtlMinutes)
			const snap = await envStub(env, envId).snapshot(false)
			if (!snap.env_id) return fail("env_not_found", `no computer ${envId}`, { next_action: "env_list" })
			if (snap.persistent === true || snap.persistent === "1") {
				return ok({
					env_id: envId,
					persistent: true,
					expires_at: null,
					ttl_remaining_s: null,
				})
			}
			const r = await envStub(env, envId).extend(minutes, cfg.maxTtlMinutes)
			return ok({
				env_id: envId,
				expires_at: r.ttl_expires_at,
				ttl_remaining_s: Math.max(0, Math.floor((r.ttl_expires_at - Date.now()) / 1000)),
			}, { warnings: r.warnings })
		},
	}

	return [envCreate, envStatus, envList, envDestroy, envExtend]
}
