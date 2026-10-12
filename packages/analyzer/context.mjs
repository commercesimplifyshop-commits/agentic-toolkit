#!/usr/bin/env node
// Prints the code behind each customization of a map, so Claude can explain
// and classify it without opening files one by one.
//
//   node packages/analyzer/context.mjs <slug> --maps-dir <pasta> [--zone checkout] [--origin custom,thirdparty] [--unannotated] [--max-lines 50] [--ids id1,id2]

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const slug = args[0]
if (!slug || slug.startsWith('--')) {
  console.error('uso: node tools/context.mjs <slug> [--zone z] [--origin custom,thirdparty] [--unannotated] [--max-lines 50]')
  process.exit(1)
}

const mapsDir = path.resolve(flag('maps-dir') ?? 'public/maps')
const map = JSON.parse(fs.readFileSync(path.join(mapsDir, `${slug}.json`), 'utf8'))
const notesFile = path.join(mapsDir, `${slug}.annotations.json`)
const notes = fs.existsSync(notesFile) ? JSON.parse(fs.readFileSync(notesFile, 'utf8')) : { items: {} }
const root = map.project.root
const maxLines = Number(flag('max-lines') ?? 50)
const origins = (flag('origin') ?? 'custom,thirdparty').split(',')
const zone = flag('zone')
const ids = flag('ids')?.split(',')

let diIndex = null
/** interface → implementation, from every di.xml preference in app/code */
function implementationOf(cls) {
  if (!diIndex) {
    diIndex = new Map()
    const stack = [path.join(root, 'app', 'code')]
    while (stack.length) {
      const dir = stack.pop()
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) stack.push(p)
        else if (e.name === 'di.xml') {
          const text = fs.readFileSync(p, 'utf8')
          for (const m of text.matchAll(/<preference\s+for="\\?([^"]+)"\s+type="\\?([^"]+)"/g)) diIndex.set(m[1], m[2])
        }
      }
    }
  }
  return diIndex.get(cls.replace(/^\\/, ''))
}

function classPath(cls) {
  if (!cls) return null
  const file = path.join(root, 'app', 'code', ...cls.replace(/^\\/, '').split('\\')) + '.php'
  return fs.existsSync(file) ? file : null
}

/** Source of one method, brace-matched, trimmed to maxLines. */
function methodSource(file, method) {
  const text = fs.readFileSync(file, 'utf8')
  // PHP method names are case-insensitive (aroundsendContent is valid)
  const m = new RegExp(`function\\s+${method}\\s*\\(`, 'i').exec(text)
  if (!m) return null
  let i = text.indexOf('{', m.index)
  const start = text.lastIndexOf('\n', m.index) + 1
  let depth = 0
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++
    if (text[i] === '}' && --depth === 0) break
  }
  const lines = text.slice(start, i + 1).split('\n')
  return lines.length > maxLines ? [...lines.slice(0, maxLines), `    // … +${lines.length - maxLines} linhas`].join('\n') : lines.join('\n')
}

function snippets(item) {
  const d = item.details
  const out = []
  const push = (cls, methods) => {
    const file = classPath(implementationOf(cls ?? '')) ?? classPath(cls)
    if (!file) return out.push(`(classe ${cls} não está em app/code)`)
    const rel = path.relative(root, file).split(path.sep).join('/')
    for (const method of methods) {
      const src = methodSource(file, method)
      if (src) out.push(`// ${rel}\n${src}`)
    }
  }
  switch (item.kind) {
    case 'plugin':
      push(d.type, (d.methods ?? []).map((m) => m.replace(/^(\w+):(\w)/, (_, t, c) => t + c.toUpperCase())))
      break
    case 'observer':
    case 'cron':
      push(d.instance, [item.kind === 'cron' ? d.method : 'execute'])
      break
    case 'rest':
      push(d.serviceClass, [d.serviceMethod])
      break
    case 'graphql':
      push(d.resolver, ['resolve'])
      break
    case 'preference': {
      const file = classPath(d.type)
      if (file) {
        const text = fs.readFileSync(file, 'utf8')
        const methods = [...text.matchAll(/public\s+function\s+(\w+)/g)].map((m) => m[1]).filter((m) => m !== '__construct')
        out.push(`// ${path.relative(root, file).split(path.sep).join('/')} sobrescreve: ${methods.join(', ') || '(nenhum método público)'}`)
        for (const m of methods.slice(0, 3)) {
          const src = methodSource(file, m)
          if (src) out.push(src)
        }
      }
      break
    }
    case 'queue':
      for (const h of d.handlers ?? []) push(h.type, [h.method])
      break
    case 'route': {
      // Controllers answering this frontName: Controller/<Path>/<Action>.php
      const [vendor, mod] = item.module.split('_')
      const dir = path.join(root, 'app', 'code', vendor, mod, 'Controller', ...(d.area === 'adminhtml' ? ['Adminhtml'] : []))
      const found = []
      const stack = fs.existsSync(dir) ? [dir] : []
      while (stack.length && found.length < 15) {
        const cur = stack.pop()
        for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
          const p = path.join(cur, e.name)
          if (e.isDirectory()) {
            if (d.area !== 'adminhtml' && e.name === 'Adminhtml') continue
            stack.push(p)
          } else if (e.name.endsWith('.php')) found.push(path.relative(dir, p).split(path.sep).join('/'))
        }
      }
      out.push(`// controllers (${path.relative(root, dir).split(path.sep).join('/')}): ${found.join(', ') || 'nenhum'}`)
      break
    }
  }
  return out
}

const selected = map.items.filter(
  (i) =>
    origins.includes(i.origin) &&
    (!zone || i.zone === zone) &&
    (!ids || ids.includes(i.id)) &&
    (!args.includes('--unannotated') || !notes.items?.[i.id]),
)

console.log(`# ${map.project.name} · ${selected.length} itens${zone ? ` · zona ${zone}` : ''}\n`)
for (const item of selected) {
  console.log(`## ${item.id}`)
  console.log(`zona atual: ${item.zone} (${item.reason}) · módulo: ${item.module} · ${item.subtitle}`)
  const code = snippets(item)
  if (code.length) console.log('```php\n' + code.join('\n\n') + '\n```')
  console.log()
}
