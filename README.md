# desktop-mcp-host

A self-hosted MCP broker plus a lightweight foreground agent for controlling
your own Linux, macOS and Windows computers.

It reuses the durable execution model from gha-mcp-host, but it does not use
GitHub Actions runners.

    AI clients -- stateless MCP --> broker <-- outbound long-poll -- npx agent
                                   |
                                   +-- durable host/job state
                                   +-- resumable output
                                   +-- no long-lived MCP session table

## Quick start

Broker:

    cp .env.example .env
    # Set PUBLIC_URL, BROKER_SECRET and MCP_AUTH_TOKEN.
    docker compose up -d

Agent:

    DESKTOP_MCP_BROKER_SECRET='your-agent-secret' \
    npx --yes github:nmt3325/desktop-mcp-host \
      connect --broker https://your-host.example --name my-pc

Press Ctrl+C to stop the host agent.

## MCP tools

The MCP surface intentionally uses the native gha-mcp-style tools.

Host discovery:

- env_list
- env_status

Execution:

- execute
- without_sandbox
- start_command
- poll_job
- stop_job

Files:

- read_file
- write_file
- list_directory
- get_image
- get_file

There is no env_create, env_extend or env_destroy. Hosts self-register when the
npx agent starts. There is no lease/TTL; a host is considered online from its
recent agent heartbeat and becomes offline after the agent stops.

All execution and file tools use env_id from env_list.

## Concurrency

One computer runs one foreground control agent. It starts a bounded worker pool:
4 workers by default, configurable up to 8 with --workers.

Multiple MCP clients and AI agents can target the same env_id concurrently.
Jobs are durably queued and claimed by the host workers. MCP itself remains
stateless, so repeated client initialization does not create long-lived MCP
server sessions.

## Repository layout

- cli.mjs: npx entry point
- agent.mjs, lib/: cross-platform foreground host agent
- broker/src/: stateless MCP frontend and durable host/job state
- broker/selfhost/: Node + SQLite self-hosted broker
- Dockerfile / compose.yaml: broker deployment
- LOCAL_AGENT.md: npx host-agent details
- SELF_HOSTING.md: broker deployment

GitHub Actions in this repository are only CI and image publication; they are
not execution hosts.
