# desktop-mcp broker

Stateless MCP frontend and durable job broker for local host agents.

The broker never creates hosts. A host appears when an npx agent enrolls and
keeps an outbound long-poll connection open.

## MCP tools

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

There are no host lifecycle or lease tools.

## State model

MCP transport is stateless. Durable state belongs to hosts and jobs, not MCP
sessions. Command output can be resumed by byte offset after client timeouts.

Hosts have no TTL. Online/offline status is based on the latest agent heartbeat.

## Authentication

MCP clients use MCP_AUTH_TOKEN.

Host agents use BROKER_SECRET only for the signed enrollment request, then use a
per-host agent token for control, queue polling and output upload.
