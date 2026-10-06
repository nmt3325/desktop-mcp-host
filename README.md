# desktop-mcp-host

A separate MCP host for controlling your own Linux, macOS and Windows computers
from ChatGPT, Claude, Notion and other MCP clients.

It is derived from the durable execution model that worked in gha-mcp-host, but
it is a different tool: it does not provision or use GitHub Actions runners.

Architecture:

    AI clients -- stateless MCP --> broker <-- outbound long-poll -- npx agent on your PC
                                   |
                                   +-- durable device/job state
                                   +-- resumable output
                                   +-- no long-lived MCP session table

## Why

The MCP frontend is stateless. Clients may initialize repeatedly without filling
a server-side MCP session map.

The computer agent is intentionally foreground-first. It is not installed as a
system service. Start it when you want the computer controllable and press
Ctrl+C to disconnect it.

One foreground agent process manages the same bounded worker model inherited from
gha-mcp-host, so multiple AI agents can orchestrate the same computer without
starting one host process per AI client.

## Quick start

### 1. Run the broker

    cp .env.example .env
    # Set PUBLIC_URL, BROKER_SECRET and MCP_AUTH_TOKEN.
    docker compose up -d

The MCP endpoint is:

    https://your-host.example/mcp

MCP clients authenticate with MCP_AUTH_TOKEN.

### 2. Connect a computer with npx

No clone and no global install are required:

    DESKTOP_MCP_BROKER_SECRET='your-agent-secret' \
    npx --yes github:nmt3325/desktop-mcp-host \
      connect --broker https://your-host.example --name my-pc

Stop it with Ctrl+C.

After an npm release, the shorter form is:

    DESKTOP_MCP_BROKER_SECRET='your-agent-secret' \
    npx @nmt3325/desktop-mcp-host \
      connect --broker https://your-host.example --name my-pc

For secrets you do not want in command-line arguments:

    npx --yes github:nmt3325/desktop-mcp-host \
      connect --broker https://your-host.example \
      --secret-file ~/.config/desktop-mcp/secret \
      --name my-pc

### 3. Use it from MCP

Call list_devices first. With exactly one online device, most Desktop
Commander-style tools may omit deviceId.

Desktop Commander-style tools include:

- list_devices, who_am_i, ping, get_config
- start_process, read_process_output, force_terminate, list_sessions
- read_file, write_file, list_directory

The native durable tool set is also available:

- env_list, env_status
- execute, start_command, poll_job, stop_job
- get_image, get_file

## Concurrency

One computer runs one foreground control agent. That agent starts a bounded
worker pool; default 4 workers, configurable up to 8 with --workers.

Multiple MCP clients and AI agents can target the same device concurrently.
MCP requests themselves are stateless; executable jobs are queued durably and
claimed by the host workers.

This is the same execution/queue model inherited from gha-mcp-host rather than
the long-lived MCP-session model used by Desktop Commander Relay.

## Repository layout

- cli.mjs: npx entry point
- agent.mjs, lib/: cross-platform foreground computer agent
- broker/src/: stateless MCP frontend and durable device/job state
- broker/selfhost/: Node + SQLite self-hosted broker
- Dockerfile / compose.yaml: broker deployment
- LOCAL_AGENT.md: npx agent details
- SELF_HOSTING.md: broker deployment

GitHub Actions in this repository are only CI and image publication. They are
not used as execution hosts.
