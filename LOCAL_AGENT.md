# npx computer agent

The computer-side component is foreground-first and does not need a system
service or global installation.

## Start

From any directory:

    DESKTOP_MCP_BROKER_SECRET='replace-me' \
    npx --yes github:nmt3325/desktop-mcp-host \
      connect --broker https://mcp.example.com --name my-computer

Press Ctrl+C to disconnect.

The agent makes outbound HTTPS long-polls to the broker. No inbound port or SSH
server is required on the controlled computer.

## Options

    --broker <url>          Broker base URL
    --secret <secret>       Enrollment secret
    --secret-file <path>    Read enrollment secret from a file
    --name <name>           Device display name
    --device-id <id>        Override stable derived device id
    --workers <1-8>         Parallel host workers, default 4
    --root <path>           State/job directory
    --wait <5-55>           Long-poll duration

Environment equivalents use the DESKTOP_MCP_ prefix.

The default device id is stable for the combination of platform, hostname and
local username, so stopping and starting npx reconnects as the same computer.

## Multiple AI agents

Do not start one npx process per AI agent.

Run one:

    npx --yes github:nmt3325/desktop-mcp-host connect ...

and let all MCP clients target that deviceId. The single control process owns
the host and starts its bounded exec worker pool internally.

The MCP frontend is stateless. Ten clients initializing MCP do not create ten
long-lived server sessions.

## Secret handling

Prefer DESKTOP_MCP_BROKER_SECRET or --secret-file over --secret because command
line arguments can be visible in a local process listing.

The broker enrollment secret is not passed into AI-executed child commands.
MCP_AUTH_TOKEN is separate and belongs on the broker/MCP-client side only.

## Local files

npx/npm may keep its normal package cache, but this tool does not install a
service, LaunchAgent, scheduled task or global binary.

The agent keeps job/output state under ~/.desktop-mcp by default so output can
be recovered while it is running and across a restart. Override this with
--root if desired.
