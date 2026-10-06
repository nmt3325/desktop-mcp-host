# Broker self-hosting

desktop-mcp-host separates the public MCP broker from the computers it controls.

    MCP client -> HTTPS -> broker <- outbound long-poll <- npx agent

The controlled computer needs no inbound port and no GitHub token.

## Broker configuration

Copy .env.example to .env and set:

    PUBLIC_URL=https://mcp.example.com
    BROKER_SECRET=<random secret shared with host agents>
    MCP_AUTH_TOKEN=<different bearer token for MCP clients>

Start:

    docker compose up -d

Build locally:

    docker compose -f compose.yaml -f compose.build.yaml up -d --build --wait

Persistent host/job data is stored in broker_data. MCP HTTP transport sessions
are not stored.

## Connect a host

    DESKTOP_MCP_BROKER_SECRET='<same BROKER_SECRET>' \
    npx --yes github:nmt3325/desktop-mcp-host \
      connect --broker https://mcp.example.com --name my-pc

Ctrl+C takes that host offline. There is no lease/TTL or extend operation.

## MCP clients

Connect to:

    https://mcp.example.com/mcp

Use MCP_AUTH_TOKEN as the bearer token. Do not give BROKER_SECRET to MCP clients.

## Security boundaries

- MCP client and host-agent credentials are separate.
- Host agents connect outbound only.
- Initial enrollment verifies a timestamped HMAC before host storage is allocated.
- Broker/agent secrets are scrubbed from AI-executed command environments.
- MCP handling is stateless.
