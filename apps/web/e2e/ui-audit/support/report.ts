import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { REPO_ROOT } from '../../support/test-env.cjs'
import { REQUESTED_ZONES, VIEWPORTS } from '../config'
import { SEVERITY_ORDER } from './findings'
import type { Finding, FindingCollector, Severity } from './findings'

// Отчёт прогона. Пишется всегда, даже когда находок нет: «сегодня чисто» — тоже результат,
// а автономному циклу нужен файл, с которым можно сравнить следующую итерацию.

export const REPORTS_DIR = join(REPO_ROOT, 'ui-audit/reports')
export const SCREENSHOTS_DIR = join(REPO_ROOT, 'ui-audit/screenshots')

const LATEST_MD = join(REPORTS_DIR, 'latest.md')
const LATEST_JSON = join(REPORTS_DIR, 'latest.json')
const PREVIOUS_JSON = join(REPORTS_DIR, 'previous.json')

interface ReportJson {
  date: string
  zones: string[]
  viewports: string[]
  counts: Record<Severity, number>
  findings: Finding[]
}

/**
 * Отпечаток находки для сравнения прогонов. Числа из текста вычищаются: «шире окна на 12px»
 * и «шире окна на 8px» — одна и та же проблема, и после частичной правки она не должна
 * выглядеть как «старая исправлена, появилась новая».
 */
function fingerprint(f: Finding): string {
  const normalized = f.message.replace(/\d+/g, '#')
  return [f.zone, f.route, f.viewport ?? '-', f.category, normalized].join('|')
}

function readPrevious(): ReportJson | null {
  if (!existsSync(LATEST_JSON)) return null
  try {
    return JSON.parse(readFileSync(LATEST_JSON, 'utf8')) as ReportJson
  } catch {
    // Битый файл от прерванного прогона — не повод ронять отчёт.
    return null
  }
}

function ensureDir(file: string): void {
  mkdirSync(dirname(file), { recursive: true })
}

/** `/dean/applications` → `dean-applications` (для имён каталогов со скриншотами). */
export function routeSlug(route: string): string {
  const slug = route.replace(/^\//, '').replace(/\//g, '-')
  return slug === '' ? 'home' : slug
}

function severityBadge(severity: Severity): string {
  return `[${severity}]`
}

function renderFinding(f: Finding): string {
  const parts = [`- ${severityBadge(f.severity)} (${f.category}) ${f.message}`]
  if (f.selector !== undefined) parts.push(`  - селектор: \`${f.selector}\``)
  if (f.snippet !== undefined) parts.push(`  - разметка: \`${f.snippet.replace(/`/g, "'")}\``)
  return parts.join('\n')
}

/** Находки одной зоны, сгруппированные экран → ширина. */
function renderResponsive(findings: Finding[]): string {
  const layout = findings.filter(
    (f) =>
      f.category === 'overflow' ||
      f.category === 'clipped' ||
      f.category === 'touch' ||
      f.category === 'typography' ||
      f.category === 'visual',
  )
  if (layout.length === 0) return '_Проблем раскладки не найдено._\n'

  const byRoute = new Map<string, Finding[]>()
  for (const f of layout) {
    const key = `${f.zone} · ${f.route}`
    const list = byRoute.get(key) ?? []
    list.push(f)
    byRoute.set(key, list)
  }

  const chunks: string[] = []
  for (const [route, routeFindings] of [...byRoute.entries()].sort()) {
    chunks.push(`### ${route}\n`)
    const byViewport = new Map<string, Finding[]>()
    for (const f of routeFindings) {
      const key = f.viewport ?? 'все ширины'
      const list = byViewport.get(key) ?? []
      list.push(f)
      byViewport.set(key, list)
    }
    // Порядок ширин — как в конфиге (от узкого к широкому), а не алфавитный.
    const order = VIEWPORTS.map((v) => v.name)
    const sorted = [...byViewport.entries()].sort(
      (a, b) => order.indexOf(a[0]) - order.indexOf(b[0]),
    )
    for (const [viewport, items] of sorted) {
      chunks.push(`#### ${viewport}\n`)
      chunks.push(items.map(renderFinding).join('\n'))
      chunks.push('')
    }
  }
  return chunks.join('\n')
}

function renderCategory(findings: Finding[], categories: string[], empty: string): string {
  const items = findings.filter((f) => categories.includes(f.category))
  if (items.length === 0) return `_${empty}_\n`
  return items
    .map((f) => `- ${severityBadge(f.severity)} \`${f.zone}\` \`${f.route}\` — ${f.message}`)
    .join('\n')
}

export interface ReportOutcome {
  markdownPath: string
  jsonPath: string
  counts: Record<Severity, number>
  fixedCount: number
  newCount: number
  status: 'PASS' | 'FAIL'
}

export function writeReport(collector: FindingCollector): ReportOutcome {
  const findings = collector.all()
  const counts = collector.countBySeverity()
  const previous = readPrevious()
  const date = new Date().toISOString()

  const previousPrints = new Set((previous?.findings ?? []).map(fingerprint))
  const currentPrints = new Set(findings.map(fingerprint))
  const fixed = (previous?.findings ?? []).filter((f) => !currentPrints.has(fingerprint(f)))
  const fresh = findings.filter((f) => !previousPrints.has(fingerprint(f)))

  const zones = collector.zoneResults()
  const checkedCount = zones.reduce((sum, z) => sum + z.checked.length, 0)
  const status: 'PASS' | 'FAIL' = collector.blocking().length === 0 ? 'PASS' : 'FAIL'

  const truncatedLines = Object.entries(collector.truncated).map(
    ([category, count]) =>
      `- ${category}: скрыто ещё ${count} однотипных находок (потолок на экран)`,
  )

  const md = [
    '# StudentHub UI Audit',
    '',
    `Date: ${date}`,
    '',
    '## Summary',
    '',
    `- Pages tested: ${checkedCount}`,
    `- Viewports tested: ${VIEWPORTS.map((v) => `${v.width}×${v.height}`).join(', ')}`,
    `- Total problems: ${findings.length}`,
    `- Critical: ${counts.CRITICAL}`,
    `- High: ${counts.HIGH}`,
    `- Medium: ${counts.MEDIUM}`,
    `- Low: ${counts.LOW}`,
    '',
    '## Покрытие прогона',
    '',
    ...zones.map((z) =>
      z.unavailable !== undefined
        ? `- **${z.zone}** — не проверялась: ${z.unavailable}`
        : `- **${z.zone}** — проверено экранов: ${z.checked.length}, пропущено: ${Object.keys(z.skipped).length}`,
    ),
    '',
    ...(REQUESTED_ZONES.length > 0
      ? [
          `Зоны этого прогона: \`${REQUESTED_ZONES.join(', ')}\`. Остальные — отдельным прогоном через \`UI_AUDIT_ZONES\` (лимит входов: 5 / 15 мин с IP).`,
          '',
        ]
      : []),
    ...(collector.throttled > 0
      ? [
          `> ⚠️ Прогон получил ${collector.throttled} ответов 429 от throttler'а. Это след самого аудита (100 запросов / 60 с с IP), а не дефект интерфейса. Часть данных на экранах могла не догрузиться — находки этого прогона проверить внимательнее.`,
          '',
        ]
      : []),
    ...(truncatedLines.length > 0 ? ['### Не поместилось в отчёт', '', ...truncatedLines, ''] : []),
    '## Пропущенные экраны',
    '',
    ...zones.flatMap((z) =>
      Object.entries(z.skipped).map(([route, reason]) => `- \`${route}\` — ${reason}`),
    ),
    '',
    '## Console Errors',
    '',
    renderCategory(findings, ['console'], 'Консоль чистая.'),
    '',
    '## Network Errors',
    '',
    renderCategory(findings, ['network'], 'Неуспешных запросов нет.'),
    '',
    '## Navigation',
    '',
    renderCategory(findings, ['nav'], 'Все экраны открылись.'),
    '',
    '## Accessibility',
    '',
    renderCategory(findings, ['a11y'], 'Базовые проверки доступности пройдены.'),
    '',
    '## Responsive Problems',
    '',
    renderResponsive(findings),
    '',
    '## Fixed Problems',
    '',
    previous === null
      ? '_Первый прогон — сравнивать не с чем._'
      : fixed.length === 0
        ? '_С прошлого прогона ничего не закрылось._'
        : fixed
            .map((f) => `- ${severityBadge(f.severity)} \`${f.route}\` — ${f.message}`)
            .join('\n'),
    '',
    '## New Since Last Run',
    '',
    previous === null
      ? '_Первый прогон._'
      : fresh.length === 0
        ? '_Новых проблем не появилось._'
        : fresh
            .map((f) => `- ${severityBadge(f.severity)} \`${f.route}\` — ${f.message}`)
            .join('\n'),
    '',
    '## Remaining Problems',
    '',
    findings.length === 0
      ? '_Пусто._'
      : SEVERITY_ORDER.map((severity) => {
          const items = findings.filter((f) => f.severity === severity)
          if (items.length === 0) return null
          return `- ${severity}: ${items.length}`
        })
          .filter((line): line is string => line !== null)
          .join('\n'),
    '',
    '## Final Status',
    '',
    status,
    '',
    `Критерий: CRITICAL и HIGH равны нулю. Сейчас CRITICAL=${counts.CRITICAL}, HIGH=${counts.HIGH}.`,
    '',
  ].join('\n')

  const json: ReportJson = {
    date,
    zones: zones.map((z) => z.zone),
    viewports: VIEWPORTS.map((v) => v.name),
    counts,
    findings,
  }

  ensureDir(LATEST_MD)
  // Предыдущий прогон сохраняем рядом: по нему считается «что закрылось», и он же остаётся
  // под рукой, когда правка сделала хуже и надо посмотреть, как было.
  if (previous !== null) writeFileSync(PREVIOUS_JSON, JSON.stringify(previous, null, 2), 'utf8')
  writeFileSync(LATEST_JSON, JSON.stringify(json, null, 2), 'utf8')
  writeFileSync(LATEST_MD, md, 'utf8')

  return {
    markdownPath: LATEST_MD,
    jsonPath: LATEST_JSON,
    counts,
    fixedCount: fixed.length,
    newCount: fresh.length,
    status,
  }
}
