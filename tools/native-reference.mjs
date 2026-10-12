#!/usr/bin/env node
// Prepares a sparse checkout of magento/magento2 with only what the map needs:
// API declarations, events/di config and the PHP classes of native plugins.
//
//   node tools/native-reference.mjs 2.4.1-p1

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const tag = process.argv[2]
if (!tag) {
  console.error('uso: node tools/native-reference.mjs <tag>   (ex.: 2.4.1-p1)')
  process.exit(1)
}

const dir = path.resolve('reference', `magento2-${tag}`)
const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 256 * 1024 * 1024 }).toString()

if (!fs.existsSync(dir)) {
  fs.mkdirSync(path.dirname(dir), { recursive: true })
  execFileSync('git', ['clone', '-q', '--depth', '1', '--branch', tag, '--filter=blob:none', '--sparse', 'https://github.com/magento/magento2.git', dir], { stdio: 'inherit' })
}

const xmlPatterns = [
  '/app/code/Magento/*/etc/module.xml',
  '/app/code/Magento/*/etc/webapi.xml',
  '/app/code/Magento/*/etc/schema.graphqls',
  '/app/code/Magento/*/etc/events.xml',
  '/app/code/Magento/*/etc/*/events.xml',
  '/app/code/Magento/*/etc/di.xml',
  '/app/code/Magento/*/etc/*/di.xml',
]
git('sparse-checkout', 'set', '--no-cone', ...xmlPatterns)

// Second pass: the PHP file of every plugin declared in core di.xml, so the
// extractor can tell which methods each native plugin intercepts.
const classes = new Set()
const stack = [path.join(dir, 'app', 'code', 'Magento')]
while (stack.length) {
  const cur = stack.pop()
  for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
    const p = path.join(cur, e.name)
    if (e.isDirectory()) stack.push(p)
    else if (e.name === 'di.xml') {
      for (const m of fs.readFileSync(p, 'utf8').matchAll(/<plugin\b[^>]*\btype="\\?(Magento\\[^"]+)"/g)) classes.add(m[1])
    }
  }
}
const phpPatterns = [...classes].map((c) => `/app/code/${c.replace(/\\/g, '/').replace(/^Magento\/([^/]+)\//, 'Magento/$1/')}.php`)
git('sparse-checkout', 'set', '--no-cone', ...xmlPatterns, ...phpPatterns)

// git ls-files lists the whole index; count what is actually checked out
const onDisk = { 'events.xml': 0, 'di.xml': 0, '.php': 0 }
const walk = [path.join(dir, 'app')]
while (walk.length) {
  const cur = walk.pop()
  for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
    if (e.isDirectory()) walk.push(path.join(cur, e.name))
    else for (const suffix of Object.keys(onDisk)) if (e.name.endsWith(suffix)) onDisk[suffix]++
  }
}
console.log(`${dir}\n  events.xml: ${onDisk['events.xml']} · di.xml: ${onDisk['di.xml']} · classes de plugin: ${onDisk['.php']} de ${classes.size}`)
