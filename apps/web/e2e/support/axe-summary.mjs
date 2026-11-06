// Сводка axe-обхода (e2e/a11y-axe.e2e.ts) в markdown — для вкладки Summary прогона CI.
//
//   node apps/web/e2e/support/axe-summary.mjs [каталог-отчётов] >> "$GITHUB_STEP_SUMMARY"
//
// Отдельным скриптом, а не jq внутри workflow: группировка по правилам и список блокирующих
// в однострочниках jq нечитаемы, а здесь их можно прогнать локально на своём отчёте.
// Тест падает только на serious/critical вне allowlist; minor/moderate и терпимое по
// allowlist видно лишь в этой сводке — поэтому печатаем всё.

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const dir = path.resolve(process.argv[2] ?? 'apps/web/a11y-axe')
const BLOCKING = new Set(['serious', 'critical'])

let files = []
try {
  files = readdirSync(dir).filter((f) => f.endsWith('.json'))
} catch {
  // Каталога нет — обход не дошёл до записи отчёта ни в одной зоне.
}

const out = ['## Доступность · axe', '']

if (files.length === 0) {
  out.push('Отчёта нет — обход axe не дошёл до конца ни в одной зоне.')
} else {
  const zones = files
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')))
    .sort((a, b) => a.zone.localeCompare(b.zone))
  const findings = zones.flatMap((z) => z.findings)
  const blocking = findings.filter((f) => BLOCKING.has(f.impact) && !f.allowed)
  const allowed = findings.filter((f) => f.allowed)
  const screens = zones.reduce((n, z) => n + z.checked.length, 0)

  const cell = (s) => String(s).replaceAll('|', '\\|')

  out.push(
    `Проверено экранов: **${screens}** в ${zones.length} зонах. ` +
      `Блокирующих (serious/critical вне allowlist): **${blocking.length}**, ` +
      `терпимых по allowlist: **${allowed.length}**, всего находок: ${findings.length}.`,
    '',
  )

  if (findings.length > 0) {
    const byRule = new Map()
    for (const f of findings) {
      const row = byRule.get(f.rule) ?? {
        impact: f.impact,
        help: f.help,
        screens: new Set(),
        elements: 0,
        allowed: 0,
      }
      row.screens.add(`${f.zone} ${f.route}`)
      row.elements += f.elements
      if (f.allowed) row.allowed += 1
      byRule.set(f.rule, row)
    }
    out.push(
      '| Правило | Серьёзность | Экранов | Элементов | Из них в allowlist | Что не так |',
      '|---|---|---|---|---|---|',
    )
    for (const [rule, r] of [...byRule].sort((a, b) => a[0].localeCompare(b[0]))) {
      out.push(
        `| ${rule} | ${r.impact} | ${r.screens.size} | ${r.elements} | ${r.allowed} | ${cell(r.help)} |`,
      )
    }
    out.push('')
  }

  if (blocking.length > 0) {
    out.push(
      '### Блокирующие',
      '',
      '| Зона | Экран | Ширина | Правило | Элементов |',
      '|---|---|---|---|---|',
    )
    for (const f of blocking) {
      out.push(`| ${f.zone} | \`${f.route}\` | ${f.viewport} | ${f.rule} | ${f.elements} |`)
    }
    out.push('')
  }

  const stale = new Set(
    zones.flatMap((z) => z.staleAllowances.map((a) => `${a.rule}: ${a.routes.join(', ')}`)),
  )
  if (stale.size > 0) {
    out.push('### Записи allowlist без нарушения — починено? удалить', '')
    for (const s of stale) out.push(`- ${s}`)
    out.push('')
  }

  out.push('### Не проверено', '')
  for (const z of zones) {
    const redirected = Object.entries(z.redirected)
    const tail =
      redirected.length > 0
        ? ` — ${redirected.map(([from, to]) => `\`${from}\` → \`${to}\``).join(', ')}`
        : ''
    out.push(
      `- **${z.zone}**: пропуск реестра ${Object.keys(z.skipped).length}, ` +
        `открылся другой адрес ${redirected.length}${tail}`,
    )
  }
}

console.log(out.join('\n'))
