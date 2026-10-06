import { BASE64_RECIPES } from "./config"
import type { ToolDef } from "./mcp"
import { fail, ok } from "./result"
import { EnvListInput, EnvStatusInput, type EnvStatusArgs } from "./schemas"
import { type Bindings, envStub, guard, platformOf } from "./tools-shared"

const ONLINE_MS = 120_000

export function buildEnvTools(env: Bindings): ToolDef[] {
	const envStatus: ToolDef = {
		name: "env_status",
		title: "Inspect one host",
		description:
			"State, last contact, working directory, queue depth, recent commands and host facts for one registered computer.",
		inputSchema: EnvStatusInput,
		readOnly: true,
		async handler(args: EnvStatusArgs) {
			const envId = args.env_id
			const snap = await envStub(env, envId).snapshot(Boolean(args.verbose))
			if (!snap.env_id) return fail("env_not_found", `no host ${envId}`, { next_action: "env_list" })
			const platform = platformOf(envId)
			return ok({
				...snap,
				online: Number(snap.last_seen_ms_ago ?? Number.MAX_SAFE_INTEGER) < ONLINE_MS,
				base64_recipes: args.verbose ? BASE64_RECIPES[platform] : undefined,
			})
		},
	}

	const envList: ToolDef = {
		name: "env_list",
		title: "List registered hosts",
		description:
			"List computers registered with this broker. A host is considered online when its agent contacted the broker in the last two minutes.",
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

	return [envStatus, envList]
}
