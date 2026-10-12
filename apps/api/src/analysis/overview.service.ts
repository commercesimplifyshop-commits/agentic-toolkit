import { Injectable } from '@nestjs/common'
import fs from 'node:fs'
import path from 'node:path'
import { ReadOnlyFs } from '../readonly/readonly-fs.service'
import { GitService } from '../workspaces/git.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { MapStore } from './map-store.service'
import { ReleasesService } from './releases.service'

interface LockPackage {
  name: string
  version: string
  type?: string
  description?: string
  require?: Record<string, string>
}

export interface Highlight {
  level: 'critical' | 'warning' | 'info'
  title: string
  detail: string
  link?: string
}

const SECURITY_MODULES = ['Magento_TwoFactorAuth', 'Magento_Csp', 'Magento_Securitytxt', 'Magento_AdminAdobeIms', 'Magento_LoginAsCustomer']

/** Theme parent from theme.xml */
const parentOf = (xml: string) => xml.match(/<parent>\s*([^<]+?)\s*<\/parent>/)?.[1]

@Injectable()
export class OverviewService {
  constructor(
    private readonly rofs: ReadOnlyFs,
    private readonly workspaces: WorkspacesService,
    private readonly git: GitService,
    private readonly releases: ReleasesService,
    private readonly maps: MapStore,
  ) {}

  private cacheFile(id: string) {
    return path.join(this.workspaces.dataDirOf(id), 'overview.json')
  }

  async compute(id: string, opts: { refresh?: boolean } = {}) {
    if (!opts.refresh) {
      try {
        return JSON.parse(fs.readFileSync(this.cacheFile(id), 'utf8'))
      } catch {
        // compute below
      }
    }
    const ws = this.workspaces.get(id)
    const root = this.workspaces.rootOf(id)
    const r = this.rofs

    // ---- composer ---------------------------------------------------------------
    const lock = r.readJson<{ packages?: LockPackage[]; 'packages-dev'?: LockPackage[] }>(root, 'composer.lock')
    const packages = [...(lock?.packages ?? []), ...(lock?.['packages-dev'] ?? [])]
    const pkg = (name: string) => packages.find((p) => p.name === name)
    const composer = r.readJson<{ require?: Record<string, string>; extra?: Record<string, unknown>; repositories?: unknown }>(root, 'composer.json') ?? {}

    // ---- modules (app/etc/config.php) ---------------------------------------------
    let configPhp = ''
    try {
      configPhp = r.read(root, 'app/etc/config.php').content
    } catch {
      configPhp = ''
    }
    const modules = [...configPhp.matchAll(/'(\w+_\w+)'\s*=>\s*([01])/g)].map(([, name, on]) => ({ name, enabled: on === '1' }))
    const enabled = new Map(modules.map((m) => [m.name, m.enabled]))

    const appCodeVendors = r.isDir(root, 'app/code') ? r.list(root, 'app/code').filter((e) => e.type === 'dir').map((e) => e.name) : []
    const appCodeModules = appCodeVendors.flatMap((v) =>
      r
        .list(root, `app/code/${v}`)
        .filter((m) => m.type === 'dir' && r.exists(root, `${m.path}/etc/module.xml`))
        .map((m) => ({ name: `${v}_${m.name}`, vendor: v, own: ws.ownVendors.includes(v), enabled: enabled.get(`${v}_${m.name}`) ?? null })),
    )
    const appCodeNames = new Set(appCodeModules.map((m) => m.name))
    const moduleOrigin = (name: string) =>
      appCodeNames.has(name) ? (ws.ownVendors.includes(name.split('_')[0]) ? 'custom' : 'appcode-thirdparty') : name.startsWith('Magento_') ? 'core' : 'composer-thirdparty'
    const byOrigin = { core: 0, 'composer-thirdparty': 0, custom: 0, 'appcode-thirdparty': 0 } as Record<string, number>
    for (const m of modules.filter((m) => m.enabled)) byOrigin[moduleOrigin(m.name)]++

    // ---- composer extensions ------------------------------------------------------
    const extensions = packages
      .filter((p) => /^magento2-(module|theme|component|library)$|^metapackage$/.test(p.type ?? '') && !p.name.startsWith('magento/'))
      .map((p) => ({ name: p.name, version: p.version, type: p.type, vendor: p.name.split('/')[0], description: p.description?.slice(0, 160) }))
    const extensionVendors = Object.entries(
      extensions.reduce<Record<string, number>>((acc, e) => ((acc[e.vendor] = (acc[e.vendor] ?? 0) + 1), acc), {}),
    )
      .map(([vendor, count]) => ({ vendor, count }))
      .sort((a, b) => b.count - a.count)

    // ---- patches ----------------------------------------------------------------
    const patchFiles = [
      ...r.list(root, '').filter((e) => e.type === 'file' && /\.(patch|diff)$/i.test(e.name)).map((e) => e.path),
      ...['patches', 'm2-hotfixes', 'm2-patches'].filter((d) => r.isDir(root, d)).flatMap((d) => r.walk(root, d, { skip: [] }).filter((f) => /\.(patch|diff)$/i.test(f))),
    ].map((file) => {
      const id = path.basename(file).match(/\b(MDVA|ACSD|MC|ACP2E|BUNDLE|MAGECLOUD)-\d+/i)?.[0]?.toUpperCase()
      return { file, id, kind: id ? 'adobe' : 'custom' }
    })
    const composerPatches = composer.extra?.patches ? Object.entries(composer.extra.patches as Record<string, Record<string, string>>).flatMap(([p, list]) => Object.keys(list).map((desc) => ({ package: p, description: desc }))) : []

    // ---- security ---------------------------------------------------------------
    const sensitiveCandidates = ['auth.json', 'app/etc/env.php', '.env', 'app/etc/env.php.bak', '.magento.env.yaml']
    const relToRepo = (rel: string) => path.relative(ws.checkoutDir, path.join(root, rel)).split(path.sep).join('/')
    const sensitiveFiles = await Promise.all(
      sensitiveCandidates.filter((f) => r.exists(root, f)).map(async (file) => ({ file, tracked: await this.git.isTracked(ws.checkoutDir, relToRepo(file)) })),
    )
    const reCaptcha = modules.filter((m) => m.name.startsWith('Magento_ReCaptcha'))

    // ---- frontend ---------------------------------------------------------------
    const themes = ['frontend', 'adminhtml'].flatMap((area) =>
      r.isDir(root, `app/design/${area}`)
        ? r
            .list(root, `app/design/${area}`)
            .filter((v) => v.type === 'dir')
            .flatMap((v) =>
              r
                .list(root, v.path)
                .filter((t) => t.type === 'dir' && r.exists(root, `${t.path}/theme.xml`))
                .map((t) => ({ area, code: `${v.name}/${t.name}`, parent: parentOf(r.read(root, `${t.path}/theme.xml`).content) })),
            )
        : [],
    )
    const hyva = packages.some((p) => p.name.startsWith('hyva-themes/'))
    const breeze = packages.some((p) => p.name.startsWith('swissup/breeze'))

    // ---- infrastructure ---------------------------------------------------------
    const repoRoot = ws.checkoutDir
    const atRoots = (rel: string) => r.exists(root, rel) || r.exists(repoRoot, rel)
    const dockerFile = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml'].find(atRoots)
    let dockerServices: string[] = []
    if (dockerFile) {
      const base = r.exists(root, dockerFile) ? root : repoRoot
      const yml = r.read(base, dockerFile).content
      // only the `services:` section, up to the next top-level key (volumes:, networks:…)
      const block = (yml.split(/^services:\s*$/m)[1] ?? '').split(/^\S/m)[0]
      dockerServices = [...block.matchAll(/^ {2,4}([\w.-]+):\s*$/gm)].map((m) => m[1]).slice(0, 20)
    }
    const ci = [
      ...['Jenkinsfile', '.gitlab-ci.yml', 'bitbucket-pipelines.yml', 'azure-pipelines.yml', '.circleci/config.yml'].filter(atRoots),
      ...(r.isDir(repoRoot, '.github/workflows') ? r.list(repoRoot, '.github/workflows').map((e) => e.path) : []),
      ...r.list(root, '').filter((e) => e.type === 'file' && /^Jenkinsfile-/.test(e.name)).map((e) => e.name),
    ]
    const cloud = atRoots('.magento.app.yaml') || packages.some((p) => p.name === 'magento/magento-cloud-metapackage')
    const searchEngine = ['Magento_OpenSearch', 'Magento_Elasticsearch8', 'Magento_Elasticsearch7', 'Magento_Elasticsearch6', 'Magento_Elasticsearch'].find((m) => enabled.get(m))

    // ---- code stats --------------------------------------------------------------
    const codeFiles = r.walk(root, 'app/code', { skip: [] })
    const count = (re: RegExp) => codeFiles.filter((f) => re.test(f)).length
    let phpLines = 0
    for (const f of codeFiles.filter((f) => f.endsWith('.php')).slice(0, 30000)) {
      try {
        phpLines += r.read(root, f, 1024 * 1024).content.split('\n').length
      } catch {
        // unreadable file: skip
      }
    }
    const code = {
      files: codeFiles.length,
      php: count(/\.php$/),
      phpLines,
      xml: count(/\.xml$/),
      templates: count(/\.phtml$/),
      js: count(/\.js$/),
      tests: count(/\/Test\/.*Test\.php$/),
    }

    // ---- integration map + annotations -------------------------------------------
    const map = this.maps.readMap(id) as { items: { id: string; kind: string; origin: string; zone: string; details: Record<string, unknown> }[] } | null
    const notes = this.maps.readAnnotations(id) as { items?: Record<string, { zone?: string; risk?: { level: string } }> } | null
    // Claude's reclassifications win over the extractor's rule-based zone
    const nonNative = (map?.items.filter((i) => i.origin !== 'native') ?? []).map((i) => ({ ...i, zone: notes?.items?.[i.id]?.zone ?? i.zone }))
    const byKind = nonNative.reduce<Record<string, number>>((acc, i) => ((acc[i.kind] = (acc[i.kind] ?? 0) + 1), acc), {})
    const byZone = nonNative.reduce<Record<string, number>>((acc, i) => ((acc[i.zone] = (acc[i.zone] ?? 0) + 1), acc), {})
    const anonymousWrites = nonNative.filter((i) => i.kind === 'rest' && (i.details.acl as string[] | undefined)?.includes('anonymous') && i.details.method !== 'GET').length
    const coreRewrites = nonNative.filter((i) => i.kind === 'preference' && String(i.details.for).startsWith('Magento\\')).length
    const cutChains = nonNative.filter((i) => i.kind === 'plugin' && (i.details.aroundWithoutProceed as string[] | undefined)?.length).length
    const risks = Object.values(notes?.items ?? {}).reduce<Record<string, number>>((acc, n) => (n.risk ? ((acc[n.risk.level] = (acc[n.risk.level] ?? 0) + 1), acc) : acc), {})

    const support = await this.releases.support(ws.version)
    const gitInfo = await this.git.info(ws.checkoutDir)
    const commits = await this.git.recentCommits(ws.checkoutDir)

    const php = pkg('magento/magento2-base')?.require?.php ?? pkg('magento/framework')?.require?.php ?? composer.require?.php
    const twoFactor = enabled.get('Magento_TwoFactorAuth')

    // ---- highlights ---------------------------------------------------------------
    const highlights: Highlight[] = []
    const add = (h: Highlight) => highlights.push(h)
    if (support?.supported === false) add({ level: 'critical', title: `Versão ${support.line} fora do suporte`, detail: `Suporte regular encerrado em ${support.endOfSupport}. Sem patches de segurança oficiais.` })
    if (support?.patchesBehind && support.patchesBehind > 0) add({ level: 'warning', title: `${support.patchesBehind} patch(es) de segurança atrás`, detail: `Instalada ${support.current}; última da linha: ${support.latestInLine}.` })
    if (twoFactor === false) add({ level: 'critical', title: '2FA do admin desativado', detail: 'Magento_TwoFactorAuth está desligado em app/etc/config.php: o painel admin aceita login só com senha.', link: 'security' })
    for (const s of sensitiveFiles.filter((s) => s.tracked)) add({ level: 'critical', title: `${s.file} versionado no git`, detail: 'Arquivo com credenciais está no repositório. Remova do histórico e rotacione as credenciais.', link: 'security' })
    // Without git we can't tell if it's versioned, but its presence in the shared source is worth flagging
    if (sensitiveFiles.some((s) => s.tracked === null && s.file === 'auth.json')) add({ level: 'warning', title: 'auth.json presente no código', detail: 'Contém chaves do repo.magento.com/marketplaces. Confirme que não é distribuído junto com o projeto.', link: 'security' })
    if (reCaptcha.length && reCaptcha.every((m) => !m.enabled)) add({ level: 'warning', title: 'reCAPTCHA desativado', detail: 'Todos os módulos Magento_ReCaptcha* estão desligados.', link: 'security' })
    if (anonymousWrites) add({ level: 'warning', title: `${anonymousWrites} endpoint(s) REST anônimos de escrita`, detail: 'Rotas customizadas com ACL anonymous e método diferente de GET.', link: 'apis' })
    if (risks.alto) add({ level: 'critical', title: `${risks.alto} ponto(s) de atenção de risco alto`, detail: 'Encontrados na análise do código pela IA.', link: 'risks' })
    if (coreRewrites) add({ level: 'info', title: `${coreRewrites} classes do core substituídas por preference`, detail: 'Upgrades do Magento nessas classes não chegam à loja sem revisão.', link: 'plugins' })
    if (cutChains) add({ level: 'warning', title: `${cutChains} plugin(s) around que não chamam $proceed`, detail: 'Interrompem a cadeia: o método original e plugins internos não executam.', link: 'plugins' })
    if (patchFiles.length) add({ level: 'info', title: `${patchFiles.length} patches aplicados manualmente`, detail: `${patchFiles.filter((p) => p.kind === 'adobe').length} da Adobe (MDVA/ACSD) e ${patchFiles.filter((p) => p.kind === 'custom').length} próprios. Precisam ser revistos a cada upgrade.`, link: 'patches' })
    if (!lock) add({ level: 'warning', title: 'composer.lock ausente', detail: 'Sem as versões exatas instaladas; os números vêm das restrições do composer.json.' })
    const disabledCore = modules.filter((m) => !m.enabled && m.name.startsWith('Magento_')).length
    if (disabledCore) add({ level: 'info', title: `${disabledCore} módulos do core desativados`, detail: 'Comportamentos nativos desligados em app/etc/config.php.', link: 'modules' })

    const overview = {
      computedAt: new Date().toISOString(),
      project: { id, name: ws.name, source: ws.source, root, git: gitInfo, commits },
      magento: { edition: ws.edition, version: ws.version, framework: pkg('magento/framework')?.version, php, composerLock: Boolean(lock), cloud },
      support,
      modules: {
        total: modules.length,
        enabled: modules.filter((m) => m.enabled).length,
        disabled: modules.filter((m) => !m.enabled).map((m) => m.name),
        byOrigin,
        appCode: appCodeModules,
        appCodeVendors: appCodeVendors.map((v) => ({ vendor: v, own: ws.ownVendors.includes(v), modules: appCodeModules.filter((m) => m.vendor === v).length })),
      },
      extensions: { total: extensions.length, list: extensions, vendors: extensionVendors },
      patches: {
        qualityPatches: pkg('magento/quality-patches')?.version ?? null,
        cloudPatches: pkg('magento/magento-cloud-patches')?.version ?? null,
        files: patchFiles,
        composerPatches,
      },
      security: {
        securityPackage: pkg('magento/security-package')?.version ?? null,
        modules: SECURITY_MODULES.map((m) => ({ name: m, enabled: enabled.get(m) ?? null })),
        reCaptcha: { total: reCaptcha.length, enabled: reCaptcha.filter((m) => m.enabled).length },
        sensitiveFiles,
      },
      frontend: { themes, hyva, breeze, pageBuilder: enabled.get('Magento_PageBuilder') ?? false, graphql: enabled.get('Magento_GraphQl') ?? false },
      infrastructure: { docker: dockerFile ? { file: dockerFile, services: dockerServices } : null, ci, cloud, searchEngine, rabbitmq: enabled.get('Magento_Amqp') ?? false },
      code,
      integration: { analyzed: Boolean(map), total: nonNative.length, byKind, byZone, anonymousWrites, coreRewrites, cutChains, risks },
      highlights: highlights.sort((a, b) => ['critical', 'warning', 'info'].indexOf(a.level) - ['critical', 'warning', 'info'].indexOf(b.level)),
    }
    fs.writeFileSync(this.cacheFile(id), JSON.stringify(overview, null, 1))
    return overview
  }
}
