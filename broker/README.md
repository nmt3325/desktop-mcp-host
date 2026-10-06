# desktop-mcp broker

This directory contains the stateless MCP broker used by persistent local
computer agents.

Architecture:

    MCP client -> POST /mcp -> broker -> device/job Durable Objects
                                   ^
                                   |
                        outbound local agent

The broker does not provision compute. Linux, macOS and Windows computers
register themselves by running the repository-root agent.mjs.

## MCP design

The MCP frontend is intentionally stateless. A short-lived MCP server is built
for each request, and request completion closes it. Long-lived state such as
registered computers, command queues and output metadata is stored separately in
Durable Objects (Cloudflare) or SQLite (self-hosted).

This means clients that repeatedly initialize MCP, including clients that do not
send DELETE on shutdown, cannot exhaust a broker-side MCP session map.

## Authentication

Two independent credentials are used:

- MCP_AUTH_TOKEN: bearer token accepted only by POST /mcp.
- BROKER_SECRET: shared with local agents and used to sign enrollment.

An agent token minted after enrollment is accepted only by /agent/<device>/*.
The credential lanes do not cross-accept.

## Tools

Desktop Commander-style tools:

- list_devices
- who_am_i
- ping
- get_config
- start_process
- read_process_output
- force_terminate
- list_sessions
- read_file / write_file / list_directory

Native broker tools remain available for robust resumable jobs:

- env_list / env_status
- execute / start_command / poll_job / stop_job
- get_image / get_file

env_create is retained as a migration-compatible name but no longer provisions
anything. Start a local agent instead.

## Development

    npm install
    npm run typecheck
    npm test

Self-hosted Node/SQLite validation:

    cd selfhost
    npm ci
    npm run build
    npm test

The self-hosted E2E test covers persistent enrollment/re-enrollment,
list_devices, Desktop Commander-style start_process/read_process_output,
broker restart recovery and device removal.

## Deployment

For a Node/SQLite deployment see ../SELF_HOSTING.md and
../LOCAL_AGENT.md. Cloudflare Worker deployment remains supported through
wrangler.toml, but GitHub Actions runners are not part of the runtime.
