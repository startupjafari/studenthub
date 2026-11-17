import { Prisma } from '@prisma/client'
import {
  hasMessageSearchCriteria,
  type MessageSearchKind,
  type MessageSearchQueryInput,
} from '@studenthub/shared-schemas'

/**
 * Условия поиска сообщений (`GET /chats/search`) — отдельно от сервиса, чтобы правила вида
 * материала и совпадения текста проверялись тестом без базы и были одни для поиска в чате
 * и по всем чатам.
 */

/** Имя файла записи с микрофона: так голосовое отличают и веб, и мобильные клиенты. */
export const VOICE_NOTE_PREFIX = 'voice-'

const notVoiceName: Prisma.FileWhereInput = {
  // NOT по NULL-имени дал бы NULL и потерял файл без имени — его отдельно пропускаем.
  OR: [{ name: null }, { NOT: { name: { startsWith: VOICE_NOTE_PREFIX } } }],
}

/**
 * Вложения вида `kind` — как их рисует клиент (attachmentKind веба):
 * - media — снимки и видео, кроме отправленных «без сжатия» и записей с микрофона
 *   (веб пишет голосовое в `video/webm`, и по mime оно неотличимо от ролика);
 * - file — всё, что показывается строкой файла: не картинка/видео/аудио либо «без сжатия»;
 * - voice — записи с микрофона: имя `voice-…`, mime аудио или видео (webm);
 * - music — аудио, кроме записей с микрофона.
 */
export function searchKindFileWhere(
  kind: Exclude<MessageSearchKind, 'link'>,
): Prisma.FileWhereInput {
  switch (kind) {
    case 'media':
      return {
        asDocument: false,
        AND: [
          { OR: [{ mime: { startsWith: 'image/' } }, { mime: { startsWith: 'video/' } }] },
          notVoiceName,
        ],
      }
    case 'file':
      return {
        AND: [
          {
            OR: [
              { asDocument: true },
              {
                NOT: [
                  { mime: { startsWith: 'image/' } },
                  { mime: { startsWith: 'video/' } },
                  { mime: { startsWith: 'audio/' } },
                ],
              },
            ],
          },
          notVoiceName,
        ],
      }
    case 'voice':
      return {
        name: { startsWith: VOICE_NOTE_PREFIX },
        OR: [{ mime: { startsWith: 'audio/' } }, { mime: { startsWith: 'video/' } }],
      }
    case 'music':
      return { mime: { startsWith: 'audio/' }, AND: [notVoiceName] }
  }
}

/** Сообщение со ссылкой: превью сервера или адрес прямо в тексте (превью могло не собраться). */
const HAS_LINK: Prisma.MessageWhereInput = {
  OR: [
    { linkPreview: { not: Prisma.DbNull } },
    { content: { contains: 'http://', mode: 'insensitive' } },
    { content: { contains: 'https://', mode: 'insensitive' } },
  ],
}

/**
 * Что ищем в сообщении, без места поиска и видимости (их добавляет сервис), — набором «веток»,
 * сообщение подходит, если подходит под любую:
 * - без kind — текст сообщения содержит q;
 * - kind файла — есть вложение этого вида; с q — две ветки: подпись содержит q, ИЛИ имя
 *   вложения этого вида содержит q;
 * - link — есть ссылка; с q — совпал текст, адрес или заголовок превью;
 * - senderId, hasFile, from/to — общие условия каждой ветки.
 *
 * Ветки, а не один OR: поиск по всем чатам с OR «подпись или имя файла» планировщик вёл
 * сплошным чтением всей таблицы сообщений (вторая половина OR — подзапрос по файлам, и
 * обход по чатам человека переставал выглядеть выгодным), около двух секунд на 2,4 млн
 * сообщений. Каждая ветка отдельно идёт по индексам: подпись — по чатам человека, имя
 * файла — по триграммному индексу `files.name` (docs/PROJECT.md, «Поиск»).
 *
 * `null` — искать нечего (ни текста, ни фильтра): сервис отдаёт пустую страницу, а не всю
 * историю всех чатов.
 */
export function messageSearchArms(
  query: Pick<MessageSearchQueryInput, 'q' | 'senderId' | 'hasFile' | 'kind' | 'from' | 'to'>,
): Prisma.MessageWhereInput[] | null {
  if (!hasMessageSearchCriteria(query)) return null
  const { q, kind } = query
  const common: Prisma.MessageWhereInput[] = []
  if (query.senderId) common.push({ senderId: query.senderId })
  if (query.hasFile) common.push({ media: { some: {} } })
  if (query.from || query.to) {
    common.push({
      createdAt: {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      },
    })
  }
  const arm = (...own: Prisma.MessageWhereInput[]): Prisma.MessageWhereInput => ({
    AND: [...own, ...common],
  })
  const contentMatch = (text: string): Prisma.MessageWhereInput => ({
    content: { contains: text, mode: 'insensitive' },
  })

  if (kind === 'link') {
    if (!q) return [arm(HAS_LINK)]
    return [
      arm(HAS_LINK, {
        OR: [
          contentMatch(q),
          { linkPreview: { path: ['url'], string_contains: q, mode: 'insensitive' } },
          { linkPreview: { path: ['title'], string_contains: q, mode: 'insensitive' } },
        ],
      }),
    ]
  }
  if (kind) {
    const fileWhere = searchKindFileWhere(kind)
    if (!q) return [arm({ media: { some: fileWhere } })]
    return [
      arm({ media: { some: fileWhere } }, contentMatch(q)),
      arm({
        media: { some: { AND: [fileWhere, { name: { contains: q, mode: 'insensitive' } }] } },
      }),
    ]
  }
  return [q ? arm(contentMatch(q)) : arm()]
}

/** Те же ветки одним условием — для поиска в одном чате, где обход и так идёт по чату. */
export function messageSearchWhere(
  query: Pick<MessageSearchQueryInput, 'q' | 'senderId' | 'hasFile' | 'kind' | 'from' | 'to'>,
): Prisma.MessageWhereInput | null {
  const arms = messageSearchArms(query)
  if (!arms) return null
  return arms.length === 1 ? arms[0]! : { OR: arms }
}

/**
 * Склеить страницы веток в одну: по убыванию [createdAt, id], без повторов (сообщение может
 * подойти под обе ветки), не длиннее `take`. Каждая ветка уже отдала свои первые `take`
 * строк от того же курсора, поэтому первые `take` строк объединения среди них целиком.
 */
export function mergeSearchPages<T extends { id: string; createdAt: Date }>(
  pages: readonly T[][],
  take: number,
): T[] {
  const seen = new Set<string>()
  const all: T[] = []
  for (const page of pages) {
    for (const row of page) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      all.push(row)
    }
  }
  all.sort((a, b) => {
    const dt = b.createdAt.getTime() - a.createdAt.getTime()
    if (dt !== 0) return dt
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
  })
  return all.slice(0, take)
}
