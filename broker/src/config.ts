/*
 * Broker configuration for persistent local computer agents.
 *
 * MCP transport state is intentionally not stored here. Durable state belongs
 * to registered computers and jobs; each MCP HTTP request is handled
 * statelessly.
 */

export type BrokerConfig = {
	defaultTtlMinutes: number
	maxTtlMinutes: number
	/** Long-poll seconds handed to the agent. Must stay under the client cap. */
	agentWaitSeconds: number
	execWorkers: number
	/** How long a local agent tolerates an unreachable broker before stopping. */
	unreachableLimitSeconds: number
	/** Per-command output ceiling, enforced by the local agent at write time. */
	defaultMaxOutputBytes: number
}

function n(v: unknown, d: number): number {
	const x = Number(v)
	return Number.isFinite(x) ? x : d
}

export function loadConfig(env: Record<string, unknown>): BrokerConfig {
	return {
		defaultTtlMinutes: n(env.DEFAULT_TTL_MINUTES, 60),
		maxTtlMinutes: n(env.MAX_TTL_MINUTES, 330),
		agentWaitSeconds: n(env.AGENT_WAIT_SECONDS, 50),
		execWorkers: n(env.EXEC_WORKERS, 4),
		unreachableLimitSeconds: n(env.UNREACHABLE_LIMIT_SECONDS, 600),
		defaultMaxOutputBytes: n(env.MAX_OUTPUT_BYTES, 256 * 1024 * 1024),
	}
}

export const PLATFORMS = ["linux", "macos", "windows"] as const
export type Platform = (typeof PLATFORMS)[number]

/**
 * Platform-specific canonical commands used for binary transfer helpers.
 */
export const BASE64_RECIPES: Record<Platform, { encode: string; decode: string }> = {
	linux: {
		encode: "base64 -w0 <FILE>",
		decode: "base64 -d > <FILE>   # feed via stdin_b64",
	},
	macos: {
		encode: "base64 -b 0 -i <FILE>",
		decode: "base64 -D > <FILE>   # feed via stdin_b64",
	},
	windows: {
		encode: "[Convert]::ToBase64String([IO.File]::ReadAllBytes('<FILE>'))",
		decode: "[IO.File]::WriteAllBytes('<FILE>', [Convert]::FromBase64String($input))",
	},
}
