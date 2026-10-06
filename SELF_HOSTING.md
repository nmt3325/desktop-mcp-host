# Broker self-hosting

desktop-mcp-host separates the public MCP broker from the computers it controls.

    MCP client -> HTTPS -> broker <- outbound long-poll <- npx agent on your PC

The controlled PC needs no inbound port and no GitHub token.

## Broker configuration

Copy .env.example to .env and set at least:

    PUBLIC_URL=https://mcp.example.com
    BROKER_SECRET=<random secret shared with computer agents>
    MCP_AUTH_TOKEN=<different bearer token for MCP clients>

Start:

    docker compose up -d

Build locally instead of pulling GHCR:

    docker compose -f compose.yaml -f compose.build.yaml up -d --build --wait

Optional Caddy TLS:

    docker compose -f compose.yaml -f compose.https.yaml up -d

Persistent device/job data is stored in broker_data. MCP HTTP transport
sessions are not stored.

## Connect a computer

    DESKTOP_MCP_BROKER_SECRET='<same BROKER_SECRET>' \
    npx --yes github:nmt3325/desktop-mcp-host \
      connect --broker https://mcp.example.com --name my-pc

Ctrl+C takes that computer offline.

## MCP clients

Connect to:

    https://mcp.example.com/mcp

Use MCP_AUTH_TOKEN as the MCP bearer token. Do not give BROKER_SECRET to MCP
clients.

## Security boundaries

- MCP client credential and computer-agent credential are separate.
- Computer agents connect outbound only.
- Initial computer enrollment verifies a timestamped HMAC before device storage
  is allocated.
- Broker/agent secrets are scrubbed from AI-executed command environments.
- MCP handling is stateless, so a client that omits DELETE does not accumulate
  transport sessions.
