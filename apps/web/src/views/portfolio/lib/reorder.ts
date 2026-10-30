import type { PortfolioItem, PortfolioKind } from '../../../entities/portfolio'
import { PORTFOLIO_KINDS } from './visuals'

/**
 * Порядок показа на экране портфолио: по видам (одинаковые записи рядом), внутри вида — в
 * порядке сервера (`order`, его же видят резюме и карточка кандидата). Сортировка
 * устойчивая, поэтому серверный порядок внутри вида сохраняется.
 */
export function displayOrder(items: readonly PortfolioItem[]): PortfolioItem[] {
  const rank = (k: PortfolioKind): number => PORTFOLIO_KINDS.indexOf(k)
  return [...items].sort((a, b) => rank(a.kind) - rank(b.kind))
}

/**
 * Сдвиг записи на одно место в пределах её вида. Возвращает id всех записей в новом порядке
 * показа — ровно то, что ждёт `PUT /portfolio/order`; null — двигать некуда (край вида).
 *
 * Через границу вида не двигаем: сетка группирует записи по видам, и такой шаг на экране
 * ничего бы не изменил.
 */
export function moveWithinKind(
  shown: readonly PortfolioItem[],
  index: number,
  delta: -1 | 1,
): string[] | null {
  const target = index + delta
  const item = shown[index]
  const neighbour = shown[target]
  if (!item || !neighbour || item.kind !== neighbour.kind) return null
  const ids = shown.map((i) => i.id)
  ids[index] = neighbour.id
  ids[target] = item.id
  return ids
}

/**
 * Оптимистичный порядок в кэше — как его посчитает сервер: перечисленные первыми в
 * присланном порядке, остальные следом, `order` подряд с нуля.
 */
export function applyOrder(
  items: readonly PortfolioItem[],
  ids: readonly string[],
): PortfolioItem[] {
  const byId = new Map(items.map((i) => [i.id, i]))
  const listed = new Set(ids)
  const head = ids.flatMap((id) => byId.get(id) ?? [])
  const tail = items.filter((i) => !listed.has(i.id))
  return [...head, ...tail].map((item, order) => ({ ...item, order }))
}
