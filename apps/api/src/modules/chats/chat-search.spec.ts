import { Prisma } from '@prisma/client'
import { MessageSearchQuerySchema } from '@studenthub/shared-schemas'
import {
  mergeSearchPages,
  messageSearchArms,
  messageSearchWhere,
  searchKindFileWhere,
} from './chat-search'

/**
 * Мини-исполнитель FileWhereInput по одной строке файла: ровно те операторы, что собирает
 * searchKindFileWhere (startsWith, null, NOT/OR/AND, равенство). NULL ведёт себя как в SQL:
 * startsWith по NULL — не «да» и не «нет», а NOT от него — тоже не «да».
 */
type FileRow = { mime: string; name: string | null; asDocument: boolean }
type Tri = boolean | null

function evalFile(where: Prisma.FileWhereInput, row: FileRow): Tri {
  const parts: Tri[] = []
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'AND') {
      const list = (Array.isArray(cond) ? cond : [cond]) as Prisma.FileWhereInput[]
      parts.push(and(list.map((w) => evalFile(w, row))))
    } else if (key === 'OR') {
      parts.push(or((cond as Prisma.FileWhereInput[]).map((w) => evalFile(w, row))))
    } else if (key === 'NOT') {
      const list = (Array.isArray(cond) ? cond : [cond]) as Prisma.FileWhereInput[]
      parts.push(and(list.map((w) => not(evalFile(w, row)))))
    } else if (key === 'asDocument') {
      parts.push(row.asDocument === cond)
    } else {
      const value = row[key as 'mime' | 'name']
      if (cond === null) parts.push(value === null)
      else {
        const prefix = (cond as { startsWith: string }).startsWith
        parts.push(value === null ? null : value.startsWith(prefix))
      }
    }
  }
  return and(parts)
}
const and = (xs: Tri[]): Tri => (xs.includes(false) ? false : xs.includes(null) ? null : true)
const or = (xs: Tri[]): Tri => (xs.includes(true) ? true : xs.includes(null) ? null : false)
const not = (x: Tri): Tri => (x === null ? null : !x)

const FILES: Record<string, FileRow> = {
  photo: { mime: 'image/jpeg', name: 'IMG_1.jpg', asDocument: false },
  photoNoName: { mime: 'image/png', name: null, asDocument: false },
  video: { mime: 'video/mp4', name: 'clip.mp4', asDocument: false },
  photoAsFile: { mime: 'image/jpeg', name: 'scan.jpg', asDocument: true },
  pdf: { mime: 'application/pdf', name: 'Курсовая.pdf', asDocument: false },
  voiceAudio: { mime: 'audio/webm', name: 'voice-msg.webm', asDocument: false },
  // Веб пишет голосовое в webm, а mime по содержимому браузеры отдают как video/webm.
  voiceVideo: { mime: 'video/webm', name: 'voice-msg.webm', asDocument: false },
  music: { mime: 'audio/mpeg', name: 'track.mp3', asDocument: false },
  musicNoName: { mime: 'audio/mpeg', name: null, asDocument: false },
}

function kindOf(row: FileRow): string[] {
  return (['media', 'file', 'voice', 'music'] as const).filter(
    (kind) => evalFile(searchKindFileWhere(kind), row) === true,
  )
}

describe('searchKindFileWhere — вид вложения как у клиента', () => {
  it.each([
    ['photo', ['media']],
    ['photoNoName', ['media']],
    ['video', ['media']],
    ['photoAsFile', ['file']],
    ['pdf', ['file']],
    ['voiceAudio', ['voice']],
    ['voiceVideo', ['voice']],
    ['music', ['music']],
    ['musicNoName', ['music']],
  ])('%s → %j', (file, kinds) => {
    expect(kindOf(FILES[file]!)).toEqual(kinds)
  })
})

describe('messageSearchArms', () => {
  it('ни текста, ни фильтра → null (искать нечего)', () => {
    expect(messageSearchArms({})).toBeNull()
    expect(messageSearchWhere({})).toBeNull()
  })

  it('только текст → одна ветка по тексту сообщения', () => {
    expect(messageSearchArms({ q: 'зачёт' })).toEqual([
      { AND: [{ content: { contains: 'зачёт', mode: 'insensitive' } }] },
    ])
  })

  it('только автор → одна ветка без текста', () => {
    expect(messageSearchArms({ senderId: 'u2' })).toEqual([{ AND: [{ senderId: 'u2' }] }])
  })

  it('вид файла без текста → наличие вложения этого вида', () => {
    expect(messageSearchArms({ kind: 'file' })).toEqual([
      { AND: [{ media: { some: searchKindFileWhere('file') } }] },
    ])
  })

  it('вид файла с текстом → ветка подписи и ветка имени файла того же вида', () => {
    const arms = messageSearchArms({ kind: 'music', q: 'track', senderId: 'u2' })
    const fileWhere = searchKindFileWhere('music')
    expect(arms).toEqual([
      {
        AND: [
          { media: { some: fileWhere } },
          { content: { contains: 'track', mode: 'insensitive' } },
          { senderId: 'u2' },
        ],
      },
      {
        AND: [
          {
            media: {
              some: { AND: [fileWhere, { name: { contains: 'track', mode: 'insensitive' } }] },
            },
          },
          { senderId: 'u2' },
        ],
      },
    ])
    expect(messageSearchWhere({ kind: 'music', q: 'track', senderId: 'u2' })).toEqual({
      OR: arms,
    })
  })

  it('ссылки с текстом → текст, адрес или заголовок превью в одной ветке', () => {
    const arms = messageSearchArms({ kind: 'link', q: 'example' })
    expect(arms).toHaveLength(1)
    const [hasLink, match] = (arms![0] as { AND: Prisma.MessageWhereInput[] }).AND
    expect(hasLink!.OR).toContainEqual({ linkPreview: { not: Prisma.DbNull } })
    expect(match!.OR).toEqual([
      { content: { contains: 'example', mode: 'insensitive' } },
      { linkPreview: { path: ['url'], string_contains: 'example', mode: 'insensitive' } },
      { linkPreview: { path: ['title'], string_contains: 'example', mode: 'insensitive' } },
    ])
  })

  it('период → границы включительно, можно одну', () => {
    expect(messageSearchArms({ from: '2026-05-01T00:00:00.000Z' })).toEqual([
      { AND: [{ createdAt: { gte: new Date('2026-05-01T00:00:00.000Z') } }] },
    ])
    expect(messageSearchArms({ to: '2026-05-31T23:59:59.999Z', hasFile: true })?.[0]?.AND).toEqual([
      { media: { some: {} } },
      { createdAt: { lte: new Date('2026-05-31T23:59:59.999Z') } },
    ])
  })
})

describe('mergeSearchPages', () => {
  const row = (id: string, day: number) => ({ id, createdAt: new Date(Date.UTC(2026, 4, day)) })

  it('по убыванию времени, при равном — по id, без повторов, не длиннее take', () => {
    const merged = mergeSearchPages(
      [
        [row('b', 20), row('x', 10)],
        [row('c', 20), row('x', 10), row('a', 1)],
      ],
      3,
    )
    expect(merged.map((r) => r.id)).toEqual(['c', 'b', 'x'])
  })
})

describe('MessageSearchQuerySchema', () => {
  it('пустой q — то же, что его нет; короткий q по-прежнему отклоняется', () => {
    expect(MessageSearchQuerySchema.parse({ q: '  ' }).q).toBeUndefined()
    expect(MessageSearchQuerySchema.parse({ q: ' ок ' }).q).toBe('ок')
    expect(MessageSearchQuerySchema.safeParse({ q: 'а' }).success).toBe(false)
  })

  it('kind и период; конец раньше начала → ошибка', () => {
    const ok = MessageSearchQuerySchema.parse({
      kind: 'voice',
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-02T00:00:00.000Z',
    })
    expect(ok).toMatchObject({ kind: 'voice', limit: 20 })
    expect(MessageSearchQuerySchema.safeParse({ kind: 'sticker' }).success).toBe(false)
    expect(
      MessageSearchQuerySchema.safeParse({
        from: '2026-05-02T00:00:00.000Z',
        to: '2026-05-01T00:00:00.000Z',
      }).success,
    ).toBe(false)
  })
})
