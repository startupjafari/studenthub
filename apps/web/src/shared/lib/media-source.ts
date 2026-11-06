import type { MediaSource } from '../api/media'

// Выбор вариантов медиа на клиенте. Сервер отдаёт готовый список копий, браузер выбирает
// подходящую сам по srcset/sizes — здесь только сборка этих атрибутов.

/** `srcset` из копий; оригинал добавляется последним кандидатом, если известна его ширина. */
export function srcSetOf(
  sources: readonly MediaSource[] | undefined,
  original?: { url: string; width?: number | null },
): string | undefined {
  const list = [...(sources ?? [])]
  if (list.length === 0) return undefined
  const largest = list[list.length - 1]?.width ?? 0
  if (original?.url && original.width && original.width > largest) {
    list.push({ url: original.url, width: original.width, height: 0 })
  }
  return list.map((s) => `${s.url} ${s.width}w`).join(', ')
}

/** Самая маленькая копия не уже `minWidth` (иначе самая большая) — постер, миниатюра. */
export function pickSource(
  sources: readonly MediaSource[] | undefined,
  minWidth: number,
): MediaSource | undefined {
  if (!sources || sources.length === 0) return undefined
  return sources.find((s) => s.width >= minWidth) ?? sources[sources.length - 1]
}
