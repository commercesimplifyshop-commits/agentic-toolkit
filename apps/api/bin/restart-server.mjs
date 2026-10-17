#!/usr/bin/env node
/**
 * Restarts the Agentic Toolkit server after a build (the Studio's "Reiniciar servidor"). The running
 * server calls it and exits; this script waits, in a detached process, until the port is free and
 * starts the server again from apps/api/dist/main.js, logging to the given file.
 *
 *   node restart-server.mjs --port 4310 --log <file>
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const port = Number(arg('--port', '4310'))
const log = arg('--log', '')
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..', '..')
const main = path.join(root, 'apps', 'api', 'dist', 'main.js')

if (!process.argv.includes('--wait')) {
  // detach a copy that outlives the server, and return at once
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2), '--wait'], { detached: true, stdio: 'ignore', cwd: root })
  child.unref()
  process.exit(0)
}

const free = () =>
  new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' })
    s.once('connect', () => (s.destroy(), resolve(false)))
    s.once('error', () => resolve(true))
  })

for (let i = 0; i < 60 && !(await free()); i++) await new Promise((r) => setTimeout(r, 500))
const out = log ? fs.openSync(log, 'a') : 'ignore'
const server = spawn(process.execPath, [main], { detached: true, stdio: ['ignore', out, out], cwd: root, env: process.env })
server.unref()
process.exit(0)
