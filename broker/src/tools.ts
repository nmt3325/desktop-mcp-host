import type { BrokerConfig } from "./config"
import type { ToolDef } from "./mcp"
import { buildEnvTools } from "./tools-env"
import { buildFsTools } from "./tools-fs"
import { buildRunTools } from "./tools-run"
import type { Bindings } from "./tools-shared"

export type { Bindings } from "./tools-shared"

/**
 * Native gha-mcp-style surface for permanent local hosts:
 * host discovery/status, command execution, and files.
 *
 * There are intentionally no host lifecycle tools. A host appears after its
 * foreground agent registers and becomes offline when that agent stops.
 */
export function buildTools(env: Bindings, cfg: BrokerConfig): ToolDef[] {
	return [...buildEnvTools(env), ...buildRunTools(env, cfg), ...buildFsTools(env, cfg)]
}
