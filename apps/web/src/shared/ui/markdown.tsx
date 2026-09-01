'use client'

import type { ReactNode } from 'react'
import { cn } from '../lib/utils'

/**
 * Разбор и вывод ограниченного markdown: **жирный**, *курсив*, ~~зачёркнутый*,
 * `код`, [ссылка](url), списки, цитата.
 *
 * Пишем сами, а не берём библиотеку: полный markdown в посте студенческой ленты не
 * нужен (таблицы, картинки, HTML), а сторонний парсер — это новая зависимость и
 * лишний вес в бандле ленты.
 *
 * Результат — React-элементы. `dangerouslySetInnerHTML` здесь не используется
 * НИГДЕ и появиться не должен: текст пишут пользователи, и любая вставка сырого
 * HTML превратила бы разметку поста в XSS.
 */

/** Схемы ссылок, которые разрешено открывать. Всё остальное (`javascript:`) — не ссылка. */
const SAFE_SCHEMES = ['http://', 'https://', 'mailto:']

function isSafeHref(href: string): boolean {
  const value = href.trim().toLowerCase()
  return SAFE_SCHEMES.some((s) => value.startsWith(s))
}

// Разметка внутри строки. Порядок важен: код первым, иначе `**` внутри кода съест жирный.
const INLINE = [
  { re: /`([^`\n]+)`/, render: (v: string, k: string) => <code key={k} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{v}</code> }, // prettier-ignore
  { re: /\*\*([^*\n]+)\*\*/, render: (v: string, k: string) => <strong key={k}>{v}</strong> },
  { re: /~~([^~\n]+)~~/, render: (v: string, k: string) => <s key={k}>{v}</s> },
  { re: /\*([^*\n]+)\*/, render: (v: string, k: string) => <em key={k}>{v}</em> },
] as const

const LINK_RE = /\[([^\]\n]+)\]\(([^)\s]+)\)/
// Упоминание: @логин. Правила логина — как у профиля: латиница, цифры, точка,
// подчёркивание и дефис. Ссылку не ставим: маршрута профиля по логину пока нет,
// поэтому упоминание только выделяется — иначе ссылка вела бы в никуда.
const MENTION_RE = /(^|[^\w@])@([a-zA-Z0-9._-]{2,32})/

/** Рекурсивный разбор строки: находим первое совпадение и делим текст на три части. */
function parseInline(text: string, key: string): ReactNode[] {
  const link = LINK_RE.exec(text)
  if (link) {
    const [full, label, href] = link
    const before = text.slice(0, link.index)
    const after = text.slice(link.index + full.length)
    return [
      ...parseInline(before, `${key}b`),
      isSafeHref(href ?? '') ? (
        <a
          key={`${key}l`}
          href={href}
          target="_blank"
          // noreferrer обязателен вместе с noopener: чужая страница не должна получить
          // ни ссылку на наше окно, ни адрес источника перехода.
          rel="noopener noreferrer nofollow"
          className="text-primary hover:underline"
        >
          {label}
        </a>
      ) : (
        // Небезопасная схема — показываем подпись обычным текстом, ссылкой не делаем.
        <span key={`${key}l`}>{label}</span>
      ),
      ...parseInline(after, `${key}a`),
    ]
  }

  const mention = MENTION_RE.exec(text)
  if (mention) {
    const [full, lead, login] = mention
    const at = mention.index + (lead?.length ?? 0)
    return [
      ...parseInline(text.slice(0, at), `${key}mb`),
      <span key={`${key}mn`} className="font-medium text-primary">
        @{login}
      </span>,
      ...parseInline(text.slice(mention.index + full.length), `${key}ma`),
    ]
  }

  for (const [i, rule] of INLINE.entries()) {
    const m = rule.re.exec(text)
    if (!m) continue
    const [full, value] = m
    return [
      ...parseInline(text.slice(0, m.index), `${key}b${i}`),
      rule.render(value ?? '', `${key}m${i}`),
      ...parseInline(text.slice(m.index + full.length), `${key}a${i}`),
    ]
  }

  return text ? [text] : []
}

interface Block {
  kind: 'p' | 'ul' | 'ol' | 'quote'
  lines: string[]
}

/** Разбор построчно в блоки: соседние строки одного вида собираются в один список. */
function parseBlocks(source: string): Block[] {
  const blocks: Block[] = []
  for (const raw of source.split('\n')) {
    // Перенос строки внутри абзаца markdown помечает обратным слешем в конце строки
    // (так его пишет редактор поля). Сам слеш — разметка, а не текст: строки мы и так
    // выводим по отдельности, поэтому его достаточно снять.
    const line = raw.trimEnd().replace(/\\$/, '')
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    const quote = /^\s*>\s?(.*)$/.exec(line)
    const kind: Block['kind'] = bullet ? 'ul' : ordered ? 'ol' : quote ? 'quote' : 'p'
    const content = (bullet ?? ordered ?? quote)?.[1] ?? line
    const last = blocks[blocks.length - 1]
    // Пустая строка обрывает абзац, но не создаёт пустой блок.
    if (kind === 'p' && content.trim() === '') {
      if (last) blocks.push({ kind: 'p', lines: [] })
      continue
    }
    if (last && last.kind === kind && last.lines.length > 0) last.lines.push(content)
    else blocks.push({ kind, lines: [content] })
  }
  return blocks.filter((b) => b.lines.length > 0)
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseBlocks(source)

  return (
    <div className={cn('flex flex-col gap-2 text-sm leading-relaxed break-words', className)}>
      {blocks.map((block, i) => {
        const items = block.lines.map((l, j) => parseInline(l, `${i}-${j}`))
        if (block.kind === 'ul' || block.kind === 'ol') {
          const List = block.kind === 'ul' ? 'ul' : 'ol'
          return (
            <List
              key={i}
              className={cn(
                'flex flex-col gap-0.5 pl-5',
                block.kind === 'ul' ? 'list-disc' : 'list-decimal',
              )}
            >
              {items.map((line, j) => (
                <li key={j}>{line}</li>
              ))}
            </List>
          )
        }
        if (block.kind === 'quote') {
          return (
            <blockquote
              key={i}
              className="border-l-2 border-l-border pl-3 text-muted-foreground italic"
            >
              {items.map((line, j) => (
                <p key={j}>{line}</p>
              ))}
            </blockquote>
          )
        }
        return (
          <p key={i}>
            {items.map((line, j) => (
              // Перенос строки внутри абзаца сохраняем: в объявлении это обычно
              // перечисление, набранное без списка.
              <span key={j} className="block">
                {line}
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}
