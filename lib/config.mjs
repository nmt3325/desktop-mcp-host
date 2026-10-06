import crypto from "node:crypto"
import os from "node:os"
import path from "node:path"

import { clamp, num } from "./util.mjs"

export const VERSION = "0.1.0"

export const PLATFORM =
	process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux"
export const IS_WIN = PLATFORM === "windows"

const PREFIX = PLATFORM === "windows" ? "win" : PLATFORM === "macos" ? "mac" : "linux"
const STABLE_LOCAL_ID = `${PREFIX}-${crypto
	.createHash("sha256")
	.update(`${os.hostname()}\0${os.userInfo().username}\0${PLATFORM}`)
	.digest("hex")
	.slice(0, 8)}`

const ENV_ID = process.env.DESKTOP_MCP_ENV_ID || STABLE_LOCAL_ID

export const CFG = {
	brokerUrl: String(process.env.BROKER_URL || process.env.DESKTOP_MCP_BROKER_URL || "").replace(/\/+$/, ""),
	brokerSecret: process.env.BROKER_SECRET || process.env.DESKTOP_MCP_BROKER_SECRET || "",
	envId: ENV_ID,
	deviceName: process.env.DESKTOP_MCP_DEVICE_NAME || os.hostname(),
	persistent: true,
	ttlMinutes: 60,
	root: process.env.DESKTOP_MCP_ROOT || path.join(os.homedir(), ".desktop-mcp"),
	runId: ENV_ID,
	runAttempt: "1",
	token: process.env.DESKTOP_MCP_TOKEN || "",
	worker: num(process.env.DESKTOP_MCP_WORKER, 0),
	execWorkers: clamp(num(process.env.DESKTOP_MCP_EXEC_WORKERS, 4), 1, 8),
	waitSeconds: clamp(num(process.env.DESKTOP_MCP_WAIT_SECONDS, 50), 5, 55),
}

/* ------------------------------------------------------------------ layout */

export const envDir = () => path.join(CFG.root, CFG.envId)
export const jobsDir = () => path.join(envDir(), "jobs")
export const jobDir = (id) => path.join(jobsDir(), id)
export const workDir = () => path.join(envDir(), "work")
export const overlayPath = () => path.join(envDir(), "overlay.env")
export const stickyCwdPath = () => path.join(envDir(), "cwd")
export const statePath = () => path.join(envDir(), "state.json")
export const shellsPath = () => path.join(envDir(), "shells.json")
export const metaPath = () => path.join(envDir(), "meta.json")
export const redactPath = () => path.join(envDir(), "redact.txt")

/* ------------------------------------------------------------------ tuning */

export const PUSH_IDLE_MS = 400
export const PUSH_SIZE_BYTES = 32 * 1024
export const PUSH_MAX_BYTES = 64 * 1024
export const STATFS_INTERVAL_MS = 250
export const RC_GRACE_MS = 3000
export const KILL_ESCALATE_MS = 3000
export const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024 * 1024
export const SPAWN_GAP_MS = 5000

/* -------------------------------------------------------------- env scrub */

export const SCRUB_PREFIXES = ["ACTIONS_", "INPUT_", "DESKTOP_MCP_"]
export const SCRUB_EXACT = [
	"BROKER_URL",
	"BROKER_SECRET",
	"GITHUB_TOKEN",
	"GH_TOKEN",
	"GH_PAT",
	"NODE_AUTH_TOKEN",
]
