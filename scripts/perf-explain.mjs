#!/usr/bin/env node
// Планы запросов горячих экранов: EXPLAIN (ANALYZE, BUFFERS) на объёме стенда (Ф13.6).
//
// Зачем отдельно от perf-baseline.mjs. Тот меряет, СКОЛЬКО отвечает эндпоинт; этот
// отвечает на вопрос ПОЧЕМУ: читает ли Postgres таблицу целиком или идёт по индексу,
// сколько буферов поднимает и совпадает ли оценка строк с фактом. Время само по себе
// обманчиво — на тёплом кэше сканирование таблицы в сотню тысяч строк укладывается в
// миллисекунды и выглядит здоровым ровно до того дня, когда строк станет миллион.
//
// Запросы здесь повторяют форму того, что шлёт Prisma (select, where, order by, limit),
// а не являются ею дословно: воспроизводить плейсхолдеры клиента незачем, план зависит
// от формы. Если форма в коде изменится, запрос здесь надо обновить — на это есть
// ссылка на модуль в каждом случае.
//
//   DATABASE_URL=...studenthub_perf node scripts/perf-explain.mjs
//
// Переменные: VERBOSE=1 — печатать план целиком, а не сводку.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const VERBOSE = process.env.VERBOSE === '1'

/** Запросы в форме, в которой их шлют сервисы. Параметры подставляются из стенда. */
function cases(ctx) {
  return [
    {
      name: 'Лента: страница по видимости',
      source: 'posts.service.ts → feed',
      sql: `
        SELECT p.id, p.title, p.content, p.created_at
        FROM posts p
        WHERE p.deleted_at IS NULL
          AND p.status = 'PUBLISHED'
          AND (p.audience = 'ALL'
               OR p.author_id = $1
               OR (p.audience = 'UNIVERSITY' AND p.university_id = $2)
               OR (p.audience = 'FACULTY' AND p.faculty_id = $3)
               OR (p.audience = 'GROUP' AND p.group_id = $4))
        ORDER BY p.pinned_at DESC NULLS LAST, p.priority DESC, p.created_at DESC, p.id DESC
        LIMIT 21`,
      params: [ctx.userId, ctx.universityId, ctx.facultyId, ctx.groupId],
    },
    {
      name: 'Чат: страница истории по курсору',
      source: 'chats.service.ts → history',
      sql: `
        SELECT m.id, m.content, m.created_at
        FROM messages m
        WHERE m.chat_id = $1 AND m.deleted_at IS NULL
        ORDER BY m.seq DESC
        LIMIT 51`,
      params: [ctx.chatId],
      skip: !ctx.chatId,
    },
    {
      name: 'Расписание группы на неделю',
      source: 'schedules.service.ts → getSchedule',
      sql: `
        SELECT pr.id, pr.day_of_week, pr.start_time
        FROM pairs pr
        WHERE pr.group_id = $1
        ORDER BY pr.day_of_week ASC, pr.start_time ASC
        LIMIT 200`,
      params: [ctx.groupId],
      skip: !ctx.groupId,
    },
    {
      name: 'Сторисы: живые по видимости',
      source: 'stories.service.ts → feed',
      sql: `
        SELECT s.id, s.created_at
        FROM stories s
        WHERE s.expires_at > now()
          AND (s.audience = 'ALL'
               OR s.author_id = $1
               OR (s.audience = 'UNIVERSITY' AND s.university_id = $2)
               OR (s.audience = 'FACULTY' AND s.faculty_id = $3)
               OR (s.audience = 'GROUP' AND s.group_id = $4))
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT 200`,
      params: [ctx.userId, ctx.universityId, ctx.facultyId, ctx.groupId],
    },
    {
      name: 'Сторисы: выборка крона по сроку',
      source: 'stories.service.ts → deleteExpired',
      sql: `SELECT s.id, s.file_id FROM stories s WHERE s.expires_at <= now() LIMIT 500`,
      params: [],
    },
    {
      name: 'Оценки студента',
      source: 'gradebook.service.ts → myGrades',
      sql: `
        SELECT g.id, g.score
        FROM grades g
        JOIN grade_columns c ON c.id = g.column_id
        WHERE g.student_id = $1 AND c.published = true
        LIMIT 500`,
      params: [ctx.userId],
    },
    {
      name: 'Посещаемость студента за период',
      source: 'attendance.service.ts → mine',
      sql: `
        SELECT a.id, a.status, a.date
        FROM attendance a
        WHERE a.student_id = $1 AND a.date >= now() - interval '90 days'
        ORDER BY a.date DESC
        LIMIT 200`,
      params: [ctx.userId],
    },
    {
      name: 'Уведомления: непрочитанные',
      source: 'notifications.service.ts → unreadCount',
      sql: `SELECT count(*) FROM notifications n WHERE n.user_id = $1 AND n.is_read = false`,
      params: [ctx.userId],
    },
  ]
}

/** Строки плана, по которым видно беду: полный проход и сортировка на диске. */
const BAD = /Seq Scan|external merge|Disk:/i

async function explain(entry) {
  const sql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${entry.sql}`
  const rows = await prisma.$queryRawUnsafe(sql, ...entry.params)
  // FORMAT JSON возвращает одну строку с массивом планов.
  const plan = rows[0]['QUERY PLAN'][0]
  const text = await prisma.$queryRawUnsafe(
    `EXPLAIN (ANALYZE, BUFFERS) ${entry.sql}`,
    ...entry.params,
  )
  const lines = text.map((r) => r['QUERY PLAN'])
  return {
    name: entry.name,
    source: entry.source,
    ms: plan['Execution Time'],
    planning: plan['Planning Time'],
    node: plan.Plan['Node Type'],
    rows: plan.Plan['Actual Rows'],
    buffers: (plan.Plan['Shared Hit Blocks'] ?? 0) + (plan.Plan['Shared Read Blocks'] ?? 0),
    warning: lines.some((l) => BAD.test(l)),
    lines,
  }
}

async function context() {
  const user = await prisma.user.findFirst({
    where: { role: 'STUDENT', groupId: { not: null } },
    select: { id: true, universityId: true, facultyId: true, groupId: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!user) throw new Error('В базе нет студента с группой — стенд не засеян?')
  const chat = await prisma.chat.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } })
  return {
    userId: user.id,
    universityId: user.universityId,
    facultyId: user.facultyId,
    groupId: user.groupId,
    chatId: chat?.id ?? null,
  }
}

async function main() {
  const ctx = await context()
  console.log('Планы сняты на пользователе', ctx.userId, '\n')
  const results = []
  for (const entry of cases(ctx)) {
    if (entry.skip) {
      console.log(`  ${entry.name}: пропущен — нет данных на стенде`)
      continue
    }
    const r = await explain(entry)
    results.push(r)
    console.log(
      `  ${r.name}: ${r.ms.toFixed(2)} мс, ${r.buffers} буферов, ${r.node}${r.warning ? '  ⚠' : ''}`,
    )
    if (VERBOSE) console.log(r.lines.map((l) => `      ${l}`).join('\n'))
  }

  console.log('\n| Запрос | Источник | Время | Буферов | Верхний узел | Строк |')
  console.log('|---|---|---|---|---|---|')
  for (const r of results) {
    console.log(
      `| ${r.name}${r.warning ? ' ⚠' : ''} | \`${r.source}\` | ${r.ms.toFixed(2)} мс | ${r.buffers} | ${r.node} | ${r.rows} |`,
    )
  }

  const bad = results.filter((r) => r.warning)
  if (bad.length) {
    console.log('\nПолный проход таблицы или сортировка на диске:')
    for (const r of bad) console.log(`  — ${r.name} (${r.source})`)
    console.log('Запустите с VERBOSE=1, чтобы увидеть план целиком.')
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
