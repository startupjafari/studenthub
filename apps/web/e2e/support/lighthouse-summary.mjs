// Сводка Lighthouse CI в markdown — для вкладки Summary прогона codeLighthouse.
//
//   node apps/web/e2e/support/lighthouse-summary.mjs [.lighthouseci] >> "$GITHUB_STEP_SUMMARY"
//
// `lhci assert` печатает только провалы и только в лог; здесь — все страницы с медианой
// по прогонам, метриками и тем, что тянет доступность вниз, чтобы разбирать красный
// прогон, не скачивая отчёты.

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const dir = path.resolve(process.argv[2] ?? '.lighthouseci')
const MIN = 0.9

let files = []
try {
  files = readdirSync(dir).filter((f) => f.startsWith('lhr-') && f.endsWith('.json'))
} catch {
  // Каталога нет — collect не дошёл до первого отчёта.
}

const out = ['## Lighthouse · мобильный', '']

if (files.length === 0) {
  out.push('Отчётов нет — сбор Lighthouse не дошёл до конца.')
} else {
  const byUrl = new Map()
  for (const f of files) {
    const lhr = JSON.parse(readFileSync(path.join(dir, f), 'utf8'))
    const url = new URL(lhr.requestedUrl)
    const key = `${url.port === '3002' ? 'лендинг ' : ''}${url.pathname}`
    byUrl.set(key, [...(byUrl.get(key) ?? []), lhr])
  }

  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }
  const mark = (score) => `${Math.round(score * 100)}${score >= MIN ? '' : ' ❌'}`

  out.push(
    `Порог — ${MIN * 100} по обеим категориям, медиана по прогонам страницы (lighthouserc.cjs).`,
    '',
    '| Страница | Прогонов | Производительность | Доступность | LCP | TBT | CLS | Не проходит по доступности |',
    '|---|---|---|---|---|---|---|---|',
  )
  for (const [page, runs] of [...byUrl].sort((a, b) => a[0].localeCompare(b[0]))) {
    const perf = median(runs.map((r) => r.categories.performance?.score ?? 0))
    const a11y = median(runs.map((r) => r.categories.accessibility?.score ?? 0))
    // Метрики и провалы — из прогона с медианной производительностью.
    const run = runs.find((r) => (r.categories.performance?.score ?? 0) === perf) ?? runs[0]
    const metric = (id) => run.audits[id]?.displayValue ?? '—'
    const a11yIds = new Set(run.categories.accessibility?.auditRefs.map((ref) => ref.id) ?? [])
    const failing = Object.values(run.audits)
      .filter((a) => a11yIds.has(a.id) && a.score !== null && a.score < 1)
      .map((a) => a.id)
    out.push(
      `| \`${page}\` | ${runs.length} | ${mark(perf)} | ${mark(a11y)} | ${metric('largest-contentful-paint')} | ${metric('total-blocking-time')} | ${metric('cumulative-layout-shift')} | ${failing.join(', ') || '—'} |`,
    )
  }
}

console.log(out.join('\n'))
