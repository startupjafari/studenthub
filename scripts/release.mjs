// Релизная обвязка: всё, что должно собраться само после того, как человек создал релиз
// и тег в интерфейсе GitHub (docs/RELEASE.md).
//
//   node scripts/release.mjs check-unreleased  — страж CI на PR в main: последняя нота
//        должна быть НЕ выпущенной (тега с такой версией ещё нет). Иначе релиз уедет без
//        текста «Что нового», и выяснится это уже на проде.
//   node scripts/release.mjs verify <tag>      — у выпускаемого тега есть нота.
//   node scripts/release.mjs body <tag>        — описание релиза: человеческий текст ноты
//        плюс conventional-коммиты с прошлого тега, сгруппированные по типам.
//
// Источник текстов — apps/web/src/entities/release/model/notes.json, тот же файл, который
// показывает приложение. Второго источника правды у релизных текстов нет.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NOTES_PATH = path.join(ROOT, 'apps/web/src/entities/release/model/notes.json')

// Порядок разделов в описании релиза. Остальные типы (chore, docs, ci, test, build, style)
// в описание не идут: ни пользователю, ни дежурному они не говорят ничего.
const SECTIONS = [
  ['feat', 'Новое'],
  ['fix', 'Исправления'],
  ['perf', 'Производительность'],
  ['refactor', 'Рефакторинг'],
  ['revert', 'Откаты'],
]

function fail(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}

function readNotes() {
  return JSON.parse(readFileSync(NOTES_PATH, 'utf8'))
}

/** Сравнение SemVer числами: '1.10.0' новее '1.9.0', лексикографически — наоборот. */
function compareVersions(a, b) {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    const l = left[i] ?? 0
    const r = right[i] ?? 0
    if (l !== r) return l > r ? 1 : -1
  }
  return 0
}

function latestNote(notes) {
  return notes.reduce((top, n) => (compareVersions(n.version, top.version) > 0 ? n : top))
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
}

/** Все релизные теги, от новых к старым. */
function releaseTags() {
  const out = git(['tag', '--list', 'v*'])
  return out
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t))
    .sort((a, b) => compareVersions(b.slice(1), a.slice(1)))
}

const stripV = (tag) => tag.replace(/^v/, '')

/** Ближайший тег старше переданного — начало диапазона коммитов для описания. */
function previousTag(tag) {
  const version = stripV(tag)
  return releaseTags().find((t) => compareVersions(stripV(t), version) < 0) ?? null
}

function commitsSince(from, to) {
  const range = from ? `${from}..${to}` : to
  const out = git(['log', range, '--no-merges', '--pretty=format:%s', '--max-count=200'])
  return out ? out.split('\n') : []
}

/** `feat(chats): текст` → { type, scope, breaking, subject }. Неформатные строки отбрасываем. */
function parseCommit(subject) {
  const m = /^(\w+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/.exec(subject)
  if (!m) return null
  return { type: m[1], scope: m[2] ?? null, breaking: Boolean(m[3]), subject: m[4] }
}

function noteMarkdown(note) {
  const ru = note.content.ru
  const lines = [`## ${ru.title}`, '']
  if (ru.intro) lines.push(ru.intro, '')
  for (const section of ru.sections) {
    if (section.heading) lines.push(`**${section.heading}**`, '')
    for (const item of section.items) {
      const icon = item.icon ? `${item.icon} ` : ''
      lines.push(`- ${icon}**${item.title}**${item.text ? ` — ${item.text}` : ''}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

function changelogMarkdown(tag) {
  const from = previousTag(tag)
  const parsed = commitsSince(from, tag)
    .map(parseCommit)
    .filter((c) => c !== null)

  const lines = ['## Что уехало', '']

  const breaking = parsed.filter((c) => c.breaking)
  if (breaking.length > 0) {
    lines.push('**Ломающие изменения**', '')
    for (const c of breaking) lines.push(`- ${c.scope ? `**${c.scope}**: ` : ''}${c.subject}`)
    lines.push('')
  }

  for (const [type, title] of SECTIONS) {
    const items = parsed.filter((c) => c.type === type && !c.breaking)
    if (items.length === 0) continue
    lines.push(`**${title}**`, '')
    for (const c of items) lines.push(`- ${c.scope ? `**${c.scope}**: ` : ''}${c.subject}`)
    lines.push('')
  }

  if (lines.length === 2) lines.push('_Значимых изменений в коммитах не найдено._', '')

  const repo = process.env.GITHUB_REPOSITORY
  if (repo && from) {
    lines.push(`**Полный список коммитов:** https://github.com/${repo}/compare/${from}...${tag}`)
  }
  return lines.join('\n')
}

const [, , command, arg] = process.argv

if (command === 'check-unreleased') {
  const note = latestNote(readNotes())
  const tag = `v${note.version}`
  if (releaseTags().includes(tag)) {
    fail(
      `Версия ${note.version} уже выпущена (тег ${tag}), а новой ноты нет.\n` +
        'Перед мёржем в main добавьте запись в apps/web/src/entities/release/model/notes.json:\n' +
        'нота едет в бандле вместе с кодом, который описывает, и после релиза её уже не подложить.\n' +
        'Релиз без заметных пользователю изменений — запись с "showModal": false.',
    )
  }
  console.log(`Готова нота ${note.version} (showModal: ${note.showModal}) — тега ${tag} ещё нет.`)
} else if (command === 'verify') {
  if (!arg) fail('Не передан тег: node scripts/release.mjs verify v1.2.0')
  const version = stripV(arg)
  if (!readNotes().some((n) => n.version === version)) {
    fail(
      `Тег ${arg} выпущен, но ноты для версии ${version} нет.\n` +
        'Пользователи не увидят, что изменилось, а в описании релиза будут только коммиты.',
    )
  }
  console.log(`Нота для ${arg} на месте.`)
} else if (command === 'body') {
  if (!arg) fail('Не передан тег: node scripts/release.mjs body v1.2.0')
  const note = readNotes().find((n) => n.version === stripV(arg))
  const parts = []
  if (note) parts.push(noteMarkdown(note))
  parts.push(changelogMarkdown(arg))
  console.log(parts.join('\n'))
} else {
  fail('Команды: check-unreleased | verify <tag> | body <tag>')
}
