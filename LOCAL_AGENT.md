# npx host agent

The computer-side component runs in the foreground and does not need a system
service or global installation.

## Start

    DESKTOP_MCP_BROKER_SECRET='replace-me' \
    npx --yes github:nmt3325/desktop-mcp-host \
      connect --broker https://mcp.example.com --name my-computer

Press Ctrl+C to stop it.

The agent uses outbound HTTPS long-polls. The controlled computer needs no
inbound port or SSH server.

## Options

    --broker <url>          Broker base URL
    --secret <secret>       Enrollment secret
    --secret-file <path>    Read the enrollment secret from a file
    --name <name>           Host display name
    --env-id <id>           Override the stable derived env_id
    --workers <1-8>         Parallel host workers, default 4
    --root <path>           State/job directory
    --wait <5-55>           Long-poll duration

The default env_id is stable for platform + hostname + local username, so
restarting npx registers the same host again.

There is no lease or expiry timer. If the broker is temporarily unreachable,
the foreground agent keeps reconnecting until you stop it.

## Multiple AI agents

Run one npx process per computer, not one per AI agent. All MCP clients target
the same env_id returned by env_list; the single control process owns the host
and starts its worker pool internally.

## Secret handling

Prefer DESKTOP_MCP_BROKER_SECRET or --secret-file over --secret because command
line arguments can be visible in a local process listing.

The enrollment secret is scrubbed from AI-executed child commands.
MCP_AUTH_TOKEN is separate and belongs only on the broker/MCP-client side.

## Local files

npx/npm may keep its normal package cache, but this tool does not install a
service, LaunchAgent, scheduled task or global binary.

Job/output state is kept under ~/.desktop-mcp by default. Override it with
--root if desired.
