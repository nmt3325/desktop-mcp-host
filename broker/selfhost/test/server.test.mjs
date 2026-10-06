import assert from "node:assert/strict"
import test from "node:test"
import { request as httpRequest } from "node:http"
import { createHmac } from "node:crypto"
import { mkdtempSync, rmSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { startServer } from "../dist/server.mjs"

const settings = {
  HOST: "127.0.0.1",
  PORT: "0",
  MCP_AUTH_TOKEN: "test-client-token",
  BROKER_SECRET: "test-enroll-secret",
}

test("fails fast when secrets are missing", async () => {
  await assert.rejects(startServer({ ...settings, MCP_AUTH_TOKEN: "" }), /MCP_AUTH_TOKEN is required/)
  await assert.rejects(startServer({ ...settings, BROKER_SECRET: "" }), /BROKER_SECRET is required/)
  await assert.rejects(startServer({ ...settings, PUBLIC_URL: "https://example.com/subpath" }), /PUBLIC_URL/)
})

test("HTTP, stateless MCP, local host enrollment, execution and restart work", { timeout: 30_000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "desktop-mcp-http-test-"))
  let broker
  const env = { ...settings, DATA_DIR: directory }
  t.after(async () => {
    await broker?.close()
    rmSync(directory, { recursive: true, force: true })
  })
  broker = await startServer(env)
  await assert.rejects(startServer(env), /already in use/)

  let id = 0
  async function rpc(method, params = {}) {
    const requestId = ++id
    const response = await fetch(`${broker.origin}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${settings.MCP_AUTH_TOKEN}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
      signal: AbortSignal.timeout(18_000),
    })
    const text = await response.text()
    assert.equal(response.status, 200, text)
    const messages = response.headers.get("content-type")?.includes("text/event-stream")
      ? text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => JSON.parse(line.slice(5).trim()))
      : [JSON.parse(text)]
    const reply = messages.find((message) => message.id === requestId)
    assert.ok(reply, text)
    assert.equal(reply.error, undefined, text)
    return { result: reply.result, messages }
  }

  async function tool(name, args = {}) {
    return rpc("tools/call", { name, arguments: args })
  }

  const envId = "linux-a1b2c3d4"

  const badHello = await fetch(`${broker.origin}/agent/${envId}/hello`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-nonce": "bad",
      "x-ts": String(Math.floor(Date.now() / 1000)),
      "x-sig": "not-a-valid-signature",
    },
    body: JSON.stringify({ device_name: "attacker" }),
  })
  assert.equal(badHello.status, 401)
  assert.equal(readdirSync(join(directory, "environments")).length, 0)

  async function agent(action, token, body) {
    const response = await fetch(`${broker.origin}/agent/${envId}/${action}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(5000),
    })
    assert.equal(response.status, 200)
    return response.json()
  }

  const health = await fetch(`${broker.origin}/healthz`)
  assert.equal(health.status, 200)
  assert.equal((await health.json()).mode, "local-host")
  assert.equal((await fetch(`${broker.origin}/missing`)).status, 404)
  assert.equal((await fetch(`${broker.origin}/mcp`, { method: "POST" })).status, 401)
  assert.equal((await fetch(`${broker.origin}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${settings.BROKER_SECRET}` },
  })).status, 401)

  const rejectedHost = await new Promise((resolveStatus, reject) => {
    const req = httpRequest(`${broker.origin}/healthz`, { headers: { host: "attacker.example" } }, (res) => {
      res.resume()
      res.on("end", () => resolveStatus(res.statusCode))
    })
    req.on("error", reject)
    req.end()
  })
  assert.equal(rejectedHost, 403)
  assert.equal((await fetch(`${broker.origin}/healthz`, { headers: { origin: "https://attacker.example" } })).status, 403)
  assert.equal((await fetch(`${broker.origin}/agent/linux-00000000/next`)).status, 404)
  assert.equal(readdirSync(join(directory, "environments")).length, 0)

  const initialized = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  })
  assert.equal(initialized.result.protocolVersion, "2025-06-18")

  const listed = await rpc("tools/list")
  const names = listed.result.tools.map((tool) => tool.name).sort()
  const expected = [
    "env_list", "env_status",
    "execute", "without_sandbox", "start_command", "poll_job", "stop_job",
    "read_file", "write_file", "list_directory", "get_image", "get_file",
  ].sort()
  assert.deepEqual(names, expected)
  for (const removed of [
    "env_create", "env_extend", "env_destroy",
    "list_devices", "who_am_i", "ping", "get_config",
    "start_process", "read_process_output", "force_terminate", "list_sessions",
  ]) {
    assert.equal(names.includes(removed), false, removed)
  }

  const ts = String(Math.floor(Date.now() / 1000))
  const nonce = "test-nonce"
  const signature = createHmac("sha256", settings.BROKER_SECRET)
    .update([envId, nonce, ts].join("\n"))
    .digest("hex")

  const hello = () => fetch(`${broker.origin}/agent/${envId}/hello`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-nonce": nonce,
      "x-ts": ts,
      "x-sig": signature,
    },
    body: JSON.stringify({
      shells: { bash: "/bin/bash" },
      shell_default: "bash",
      work_dir: "/tmp/test",
      platform: "linux",
      device_name: "test-pc",
    }),
  })

  const enrolled = await hello()
  assert.equal(enrolled.status, 200)
  const enrolledBody = await enrolled.json()
  assert.equal("ttl_expires_at" in enrolledBody, false)
  assert.equal("unreachable_limit_s" in enrolledBody, false)
  let agentToken = enrolledBody.agent_token
  assert.ok(agentToken)

  const reenrolled = await hello()
  assert.equal(reenrolled.status, 200, "local host agents must be able to re-enroll")
  agentToken = (await reenrolled.json()).agent_token
  assert.ok(agentToken)

  assert.equal((await fetch(`${broker.origin}/agent/${envId}/next`, {
    headers: { authorization: `Bearer ${settings.MCP_AUTH_TOKEN}` },
  })).status, 401)

  const envs = (await tool("env_list")).result.structuredContent
  assert.equal(envs.count, 1)
  assert.equal(envs.environments[0].env_id, envId)
  assert.equal(envs.environments[0].name, "test-pc")
  assert.equal(envs.environments[0].online, true)

  const status = (await tool("env_status", { env_id: envId, verbose: true })).result.structuredContent
  assert.equal(status.env_id, envId)
  assert.equal(status.online, true)
  assert.equal(status.facts.shell_default, "bash")
  assert.equal("expires_at" in status, false)
  assert.equal("ttl_remaining_s" in status, false)

  const quote = (word) => "'" + word.split("'").join("'\\''") + "'"
  const rendered = (argv) => argv.map(quote).join(" ")

  async function completeClaim(pending, expectedCommand) {
    let claimed
    for (let attempt = 0; attempt < 5 && !claimed; attempt++) {
      claimed = (await agent("next?wait=1&worker=0", agentToken)).command
    }
    assert.ok(claimed, "tool must enqueue a claimable command")
    assert.equal(claimed.command, expectedCommand)
    const output = Buffer.from("hello from the local computer\n")
    await agent("chunk", agentToken, {
      command_id: claimed.command_id,
      start_byte: 0,
      bytes_b64: output.toString("base64"),
      total_bytes: output.length,
      state: "exited",
      exit_code: 0,
      eof: true,
      cwd_after: "/tmp/test",
    })
    const result = await pending
    assert.equal(result.result.structuredContent.state, "exited", JSON.stringify(result))
    assert.equal(result.result.structuredContent.output, output.toString())
    return result.result.structuredContent
  }

  const nativePending = tool("execute", { env_id: envId, command: ["echo", "native"], wait_ms: 12000 })
  const nativeResult = await completeClaim(nativePending, rendered(["echo", "native"]))
  const reread = (await tool("poll_job", { env_id: envId, job_id: nativeResult.job_id, from_byte: 0 })).result.structuredContent
  assert.equal(reread.output, nativeResult.output)

  const control = await agent("control", agentToken, { wait: 1, running: [] })
  assert.deepEqual(Object.keys(control).sort(), ["actions"])

  await broker.close()
  broker = await startServer(env)
  assert.ok(broker.origin)

  const restored = (await tool("poll_job", { env_id: envId, job_id: nativeResult.job_id, from_byte: 0 })).result.structuredContent
  assert.equal(restored.state, "exited")
  assert.equal(restored.output, nativeResult.output, "terminal output must survive broker restart")

  const afterRestart = (await tool("env_list")).result.structuredContent
  assert.equal(afterRestart.environments.length, 1, "host registry must survive broker restart")

  const aborted = new AbortController()
  const longPoll = fetch(`${broker.origin}/agent/${envId}/next?wait=50`, {
    headers: { authorization: `Bearer ${agentToken}` },
    signal: aborted.signal,
  })
  await sleep(30)
  aborted.abort()
  await assert.rejects(longPoll, { name: "AbortError" })
})
