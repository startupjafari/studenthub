import { PINNED_ORDER_MAX } from '@studenthub/shared-schemas'

/**
 * Порядок закреплённых чатов — чистые функции для перетаскивания (lib/use-pinned-drag) и
 * клавиатурной альтернативы. Отдельно от DOM, чтобы правила проверялись тестом.
 */

/** Переставить элемент `from` на место `to` (остальные сдвигаются). */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items]
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item as T)
  return next
}

/**
 * Полный порядок закреплённых для `PUT /chats/pinned/order` после перестановки в видимом
 * списке.
 *
 * Видна обычно не вся «закреплёнка»: архив и «Все» — разные списки, а сервер хранит один
 * порядок на все. Отправь мы только видимые, остальные закреплённые съехали бы под них — и
 * в соседнем списке порядок поменялся бы без спроса. Поэтому видимые встают ровно на свои
 * прежние места в общем порядке, а невидимые не двигаются вовсе.
 *
 * @param allPinned все закреплённые в нынешнем порядке (как отсортирован список)
 * @param visibleOrder видимые закреплённые в новом порядке
 */
export function mergePinnedOrder(
  allPinned: readonly string[],
  visibleOrder: readonly string[],
): string[] {
  const visible = new Set(visibleOrder)
  let next = 0
  const merged = allPinned.map((id) => (visible.has(id) ? (visibleOrder[next++] ?? id) : id))
  // Видимый, но почему-то не найденный в общем порядке (свежее закрепление) — в конец.
  for (const id of visibleOrder) if (!allPinned.includes(id)) merged.push(id)
  return merged.slice(0, PINNED_ORDER_MAX)
}

/**
 * Куда встаёт перетаскиваемая строка: число остальных строк, чей центр выше центра
 * перетаскиваемой. Строки — по возрастанию `top`.
 */
export function dropIndex(
  rows: readonly { top: number; height: number }[],
  from: number,
  draggedCenter: number,
): number {
  let index = 0
  rows.forEach((r, i) => {
    if (i !== from && r.top + r.height / 2 < draggedCenter) index += 1
  })
  return index
}

/**
 * Сдвиг строки `i`, пока строка `from` висит над местом `to`: строки между ними уступают
 * место на высоту перетаскиваемой, остальные стоят.
 */
export function shiftFor(i: number, from: number, to: number, draggedHeight: number): number {
  if (from < to && i > from && i <= to) return -draggedHeight
  if (from > to && i >= to && i < from) return draggedHeight
  return 0
}

/** Где окажется верх перетаскиваемой строки на месте `to` — относительно её исходного места. */
export function dropOffset(
  rows: readonly { top: number; height: number }[],
  from: number,
  to: number,
): number {
  const src = rows[from]
  const dst = rows[to]
  if (!src || !dst || from === to) return 0
  return to > from ? dst.top + dst.height - (src.top + src.height) : dst.top - src.top
}
