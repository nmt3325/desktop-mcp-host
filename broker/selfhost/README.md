# Self-hosted broker

The self-hosted broker is the default runtime for persistent local agents.

    cd ../..
    cp .env.example .env
    # Fill in PUBLIC_URL, BROKER_SECRET and MCP_AUTH_TOKEN.
    docker compose -f compose.yaml -f compose.build.yaml up -d --build --wait

No GitHub PAT, GitHub repository or Actions runner is required.

The broker uses Node.js 24 and native SQLite. Device/job state survives broker
restarts in the broker data volume, while the MCP HTTP layer itself is
stateless.

See LOCAL_AGENT.md at the repository root for installing agents on computers.
