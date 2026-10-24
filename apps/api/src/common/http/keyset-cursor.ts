/**
 * Курсор страниц «свежие сверху» по паре (createdAt, id) — для комментариев и полки
 * «Сохранённое».
 *
 * Почему не Prisma-курсор `{ cursor: { id }, skip: 1 }`. Тот ищет строку курсора и
 * пропускает первую строку выдачи, считая её самим курсором. Если курсорную строку успели
 * удалить (комментарий стёрт навсегда) — выдача пустеет и листание обрывается; если она
 * больше не проходит фильтр (мягко удалённый комментарий) — `skip: 1` съедает соседнюю,
 * живую строку. Курсор, несущий сами значения сортировки, от судьбы строки не зависит.
 *
 * Формат — `<мс>.<id>`. Клиент передаёт `meta.cursor` обратно как есть и формат не разбирает.
 */
export interface KeysetPosition {
  createdAt: Date
  id: string
}

export function encodeKeyset(row: KeysetPosition): string {
  return `${row.createdAt.getTime()}.${row.id}`
}

/** Позиция из курсора своего формата; чужой формат (например, голый id) — null. */
export function decodeKeyset(cursor: string): KeysetPosition | null {
  const match = /^(\d{1,15})\.(.+)$/.exec(cursor)
  if (!match?.[1] || !match[2]) return null
  return { createdAt: new Date(Number(match[1])), id: match[2] }
}

/** Условие «строго раньше позиции» для сортировки [createdAt desc, id desc]. */
export function olderThan(position: KeysetPosition): {
  OR: [{ createdAt: { lt: Date } }, { createdAt: Date; id: { lt: string } }]
} {
  return {
    OR: [
      { createdAt: { lt: position.createdAt } },
      { createdAt: position.createdAt, id: { lt: position.id } },
    ],
  }
}

/** Порядок выдачи, под который считается olderThan. */
export const NEWEST_FIRST = [{ createdAt: 'desc' as const }, { id: 'desc' as const }]

/**
 * Позиция курсора: свой формат — сразу; голый id (так выглядел бы курсор клиента, который
 * запомнил id строки) — через `lookup`. Не нашлось — null: листать дальше не от чего.
 */
export async function keysetFrom(
  cursor: string,
  lookup: (id: string) => Promise<KeysetPosition | null>,
): Promise<KeysetPosition | null> {
  return decodeKeyset(cursor) ?? lookup(cursor)
}

/** Условие «строго позже позиции» — для сортировки [createdAt asc, id asc] (по порядку записи). */
export function newerThan(position: KeysetPosition): {
  OR: [{ createdAt: { gt: Date } }, { createdAt: Date; id: { gt: string } }]
} {
  return {
    OR: [
      { createdAt: { gt: position.createdAt } },
      { createdAt: position.createdAt, id: { gt: position.id } },
    ],
  }
}

/** Порядок выдачи, под который считается newerThan. */
export const OLDEST_FIRST = [{ createdAt: 'asc' as const }, { id: 'asc' as const }]
