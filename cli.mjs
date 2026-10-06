#!/usr/bin/env node

import fs from "node:fs"

const argv = process.argv.slice(2)

function valueOf(name) {
  const eq = argv.find((arg) => arg.startsWith(name + "="))
  if (eq) return eq.slice(name.length + 1)
  const i = argv.indexOf(name)
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1]
  return undefined
}

function has(name) {
  return argv.includes(name) || argv.some((arg) => arg.startsWith(name + "="))
}

function printHelp() {
  console.log(`desktop-mcp-host

Run this computer as a foreground MCP host. Nothing is installed as a system
service; Ctrl+C disconnects the host.

Usage:
  desktop-mcp-host connect [options]
  desktop-mcp-host --help
  desktop-mcp-host --version

Options:
  --broker <url>          Broker base URL
  --secret <secret>       Agent enrollment secret
  --secret-file <path>    Read the enrollment secret from a file
  --name <name>           Display name for this computer
  --env-id <id>           Override the stable derived env_id
  --workers <1-8>         Parallel command workers (default: 4)
  --root <path>           Local working/state directory
  --wait <5-55>           Long-poll duration in seconds

Environment equivalents:
  DESKTOP_MCP_BROKER_URL
  DESKTOP_MCP_BROKER_SECRET
  DESKTOP_MCP_DEVICE_NAME
  DESKTOP_MCP_ENV_ID
  DESKTOP_MCP_EXEC_WORKERS
  DESKTOP_MCP_ROOT
  DESKTOP_MCP_WAIT_SECONDS

Examples:
  DESKTOP_MCP_BROKER_SECRET=... npx --yes github:nmt3325/desktop-mcp-host \
    connect --broker https://mcp.example.com --name my-pc

  npx @nmt3325/desktop-mcp-host connect --broker https://mcp.example.com \
    --secret-file ~/.config/desktop-mcp/secret --name my-pc
`)
}

const internalRole = argv.some((arg) => arg === "--role=exec" || arg.startsWith("--role="))
if (!internalRole) {
  if (has("--help") || has("-h")) {
    printHelp()
    process.exit(0)
  }
  if (has("--version") || has("-v")) {
    console.log("0.2.0")
    process.exit(0)
  }

  const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : "connect"
  if (command !== "connect") {
    console.error(`Unknown command: ${command}`)
    printHelp()
    process.exit(2)
  }

  const broker = valueOf("--broker") || process.env.DESKTOP_MCP_BROKER_URL || process.env.BROKER_URL
  let secret = valueOf("--secret") || process.env.DESKTOP_MCP_BROKER_SECRET || process.env.BROKER_SECRET
  const secretFile = valueOf("--secret-file")
  if (secretFile) {
    secret = fs.readFileSync(secretFile, "utf8").trim()
  }

  if (!broker) {
    console.error("Missing broker URL. Pass --broker or DESKTOP_MCP_BROKER_URL.")
    process.exit(2)
  }
  if (!secret) {
    console.error("Missing enrollment secret. Pass --secret-file, --secret, or DESKTOP_MCP_BROKER_SECRET.")
    process.exit(2)
  }

  process.env.BROKER_URL = broker
  process.env.BROKER_SECRET = secret

  const name = valueOf("--name")
  const envId = valueOf("--env-id")
  const workers = valueOf("--workers")
  const root = valueOf("--root")
  const wait = valueOf("--wait")
  if (name) process.env.DESKTOP_MCP_DEVICE_NAME = name
  if (envId) process.env.DESKTOP_MCP_ENV_ID = envId
  if (workers) process.env.DESKTOP_MCP_EXEC_WORKERS = workers
  if (root) process.env.DESKTOP_MCP_ROOT = root
  if (wait) process.env.DESKTOP_MCP_WAIT_SECONDS = wait

  const shownName = name || process.env.DESKTOP_MCP_DEVICE_NAME || "this computer"
  console.error(`desktop-mcp-host: connecting ${shownName} to ${broker}`)
  console.error("desktop-mcp-host: foreground mode; press Ctrl+C to disconnect")
}

await import("./agent.mjs")
