#!/usr/bin/env node
/**
 * Agentic Toolkit MCP over stdio: a bridge for MCP clients that only start local programs (Claude
 * Desktop, Codex CLI…). Each JSON-RPC line read from stdin is sent to the app's MCP endpoint over
 * HTTP; each answer is written as one line to stdout. The app must be running.
 *
 *   AGENTIC_MCP_URL    the endpoint (default http://127.0.0.1:4310/api/mcp)
 *   AGENTIC_MCP_TOKEN  the token shown in Configurações → MCP
 */
import readline from 'node:readline'

const url = process.env.AGENTIC_MCP_URL || 'http://127.0.0.1:4310/api/mcp'
const token = process.env.AGENTIC_MCP_TOKEN || ''

const write = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`)
const errorFor = (msg, message) => (msg && msg.id !== undefined ? { jsonrpc: '2.0', id: msg.id, error: { code: -32603, message } } : null)

async function forward(line) {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } })
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` },
      body: JSON.stringify(msg),
    })
    if (res.status === 202) return
    const text = await res.text()
    if (!res.ok) {
      let detail = text
      try {
        detail = JSON.parse(text).error ?? text
      } catch {}
      const e = errorFor(msg, `Agentic Toolkit respondeu ${res.status}: ${detail}`)
      return e && write(e)
    }
    const answer = JSON.parse(text)
    for (const a of Array.isArray(answer) ? answer : [answer]) write(a)
  } catch (err) {
    const e = errorFor(msg, `Agentic Toolkit fora do ar em ${url} (${err.message}). Inicie o app e tente de novo.`)
    if (e) write(e)
  }
}

const rl = readline.createInterface({ input: process.stdin })
let queue = Promise.resolve()
rl.on('line', (line) => {
  if (line.trim()) queue = queue.then(() => forward(line))
})
rl.on('close', () => queue.then(() => process.exit(0)))
