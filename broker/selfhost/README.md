# Self-hosted broker

This is the Node + SQLite runtime used by the Docker image.

Required environment variables:
- MCP_AUTH_TOKEN
- BROKER_SECRET

Common optional settings:
- HOST
- PORT
- DATA_DIR
- PUBLIC_URL
- ALLOWED_HOSTS
- AGENT_WAIT_SECONDS
- EXEC_WORKERS
- MAX_OUTPUT_BYTES

There are no TTL or lease settings. Local host agents self-register and keep
reconnecting while their foreground npx process is running.

Build and test:

    npm ci
    npm run build
    npm test
