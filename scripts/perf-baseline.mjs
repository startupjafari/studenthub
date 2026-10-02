#!/usr/bin/env node
// Замер отклика на объёме одного вуза (docs/PERF_BASELINE.md).
//
// Зачем скрипт, а не «потыкал руками». Нужны два числа, которых глазами не получить:
// медиана с хвостом (p95 — это и есть то, что чувствует человек на плохой итерации) и
// ЧИСЛО ЗАПРОСОВ В БАЗУ НА ОДИН HTTP-ЗАПРОС. Второе важнее: тяжёлый запрос видно и по
// времени, а N+1 на маленькой базе не виден вовсе — он просыпается на объёме.
//
// Запросы к базе считаются по дельте pg_stat_database.xact_commit: Prisma гоняет каждый
// запрос своей транзакцией, поэтому дельта ≈ число запросов. Это оценка, а не точный
// счётчик (фоновые задачи API тоже коммитят), но для «2 запроса или 200» её хватает
// с запасом, а pg_stat_statements в общем контейнере недоступен — он требует
// shared_preload_libraries и перезапуска, то есть простоя чужих баз.
//
// ЗАПУСКАТЬ ТОЛЬКО ПРОТИВ ОТДЕЛЬНОЙ БАЗЫ. Скрипт сам ничего не пишет, но поднимается он
// на стенде, который наливает сид, а сид затирает данные.
//
//   DATABASE_URL=...studenthub_perf  API=http://127.0.0.1:3101  node scripts/perf-baseline.mjs
//
// Переменные: API (адрес), PERF_LOGIN/PERF_PASSWORD (чей токен брать), WARMUP, ROUNDS,
// PG_CONTAINER и PG_DB (как ходить за счётчиком транзакций; пусто — счёт отключён).

import { execFile } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'

const run = promisify(execFile)

const API = (process.env.API ?? 'http://127.0.0.1:3101').replace(/\/+$/, '')
const PREFIX = `${API}/api/v1`
const WARMUP = Number(process.env.WARMUP ?? 3)
const ROUNDS = Number(process.env.ROUNDS ?? 20)
const PG_CONTAINER = process.env.PG_CONTAINER ?? ''
const PG_DB = process.env.PG_DB ?? ''

/** Коммиты транзакций в базе стенда — грубый счётчик запросов. */
async function xactCommit() {
  if (!PG_CONTAINER || !PG_DB) return null
  try {
    const { stdout } = await run('docker', [
      'exec',
      PG_CONTAINER,
      'psql',
      '-U',
      process.env.PG_USER ?? 'postgres',
      '-d',
      PG_DB,
      '-tAc',
      `select xact_commit from pg_stat_database where datname='${PG_DB}'`,
    ])
    return Number(stdout.trim())
  } catch {
    return null
  }
}

async function login(identifier, password) {
  const res = await fetch(`${PREFIX}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  })
  if (!res.ok) throw new Error(`login ${identifier}: ${res.status} ${await res.text()}`)
  const body = await res.json()
  const token = body?.data?.accessToken ?? body?.accessToken
  if (!token)
    throw new Error(`login ${identifier}: в ответе нет accessToken: ${JSON.stringify(body)}`)
  return token
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[idx]
}

async function measure(name, path, token) {
  const headers = { authorization: `Bearer ${token}` }
  const url = `${PREFIX}${path}`

  for (let i = 0; i < WARMUP; i += 1) await fetch(url, { headers })

  // Запросы в базу — вокруг ОДНОГО вызова: дельта за серию делилась бы на число раундов
  // и прятала разброс, а нас интересует стоимость одного обращения.
  //
  // Берём МИНИМУМ из трёх проб. В дельту попадают и чужие коммиты: у API есть cron'ы с
  // шагом в минуту (публикация отложенных постов, доставка отложенных сообщений), и
  // проба, совпавшая с их тиком, даёт сотни лишних транзакций — первый прогон показал
  // 573 «запроса» у эндпоинта, который отвечает за 2 мс и отдаёт килобайт. Фоновый шум
  // прерывист, поэтому минимум из нескольких проб близок к правде, а среднее — нет.
  let queries = null
  let probe = null
  for (let i = 0; i < 3; i += 1) {
    const before = await xactCommit()
    probe = await fetch(url, { headers })
    await probe.clone().arrayBuffer()
    const after = await xactCommit()
    if (before !== null && after !== null) {
      const delta = after - before
      queries = queries === null ? delta : Math.min(queries, delta)
    }
  }

  if (!probe.ok) {
    return { name, path, status: probe.status, error: (await probe.text()).slice(0, 160) }
  }
  const bytes = (await probe.text()).length

  const times = []
  for (let i = 0; i < ROUNDS; i += 1) {
    const started = performance.now()
    const res = await fetch(url, { headers })
    await res.arrayBuffer()
    times.push(performance.now() - started)
  }
  times.sort((a, b) => a - b)

  return {
    name,
    path,
    status: probe.status,
    bytes,
    queries,
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    max: times.at(-1),
  }
}

const ms = (v) => (v === undefined ? '—' : `${v.toFixed(0)} мс`)

async function main() {
  const identifier = process.env.PERF_LOGIN
  const password = process.env.PERF_PASSWORD
  if (!identifier || !password) {
    console.error('Нужны PERF_LOGIN и PERF_PASSWORD — учётка стенда, от чьего имени мерить.')
    process.exit(2)
  }

  const token = await login(identifier, password)
  console.log(`Вход выполнен: ${identifier}`)
  console.log(`API: ${API} · прогревов ${WARMUP} · замеров ${ROUNDS}\n`)

  // Три места, где запрос идёт по самым крупным таблицам, плюс агрегат главного экрана.
  const cases = [
    ['Лента', '/posts?limit=20'],
    ['Лента, вторая страница', '/posts?limit=20&offset=20'],
    ['Список чатов', '/chats?limit=20'],
    ['Мои оценки', '/gradebook/me'],
    ['Уведомления', '/notifications?limit=20'],
    ['Расписание', '/schedules'],
    ['Сегодня (агрегат)', '/me/today'],
    ['Активность', '/me/activity?limit=20'],
  ]

  const rows = []
  for (const [name, path] of cases) {
    process.stdout.write(`  ${name}… `)
    const row = await measure(name, path, token)
    rows.push(row)
    console.log(
      row.error ? `HTTP ${row.status}` : `${row.p50.toFixed(0)} / ${row.p95.toFixed(0)} мс`,
    )
  }

  console.log('\n| Экран | Путь | p50 | p95 | макс | запросов в БД | ответ |')
  console.log('|---|---|---|---|---|---|---|')
  for (const r of rows) {
    if (r.error) {
      console.log(`| ${r.name} | \`${r.path}\` | — | — | — | — | HTTP ${r.status} |`)
      continue
    }
    const kb = (r.bytes / 1024).toFixed(0)
    console.log(
      `| ${r.name} | \`${r.path}\` | ${ms(r.p50)} | ${ms(r.p95)} | ${ms(r.max)} | ${r.queries ?? '—'} | ${kb} КБ |`,
    )
  }

  const suspicious = rows.filter((r) => !r.error && r.queries !== null && r.queries > 25)
  if (suspicious.length) {
    console.log('\nПохоже на N+1 (больше 25 запросов на один вызов):')
    for (const r of suspicious) console.log(`  — ${r.name}: ${r.queries}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
