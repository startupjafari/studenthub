// Раскладка пересекающихся по времени занятий по колонкам — как в Google Calendar:
// перекрывающиеся события показываются рядом, а не одно поверх другого.
// Общий алгоритм для read-only сетки (widgets/schedule-grid) и редактора (features/manage-schedule).

export interface TimeSpan {
  startMin: number
  endMin: number
}

export interface Placed<T extends TimeSpan> {
  item: T
  col: number // индекс колонки внутри кластера пересечений (0-based)
  cols: number // всего колонок в кластере
}

// Возвращает элементы (в порядке возрастания времени) с назначенными col/cols.
// Элементы, не пересекающиеся по времени, образуют отдельные кластеры и занимают всю ширину.
export function layoutColumns<T extends TimeSpan>(items: T[]): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
  const result: Placed<T>[] = []
  let cluster: { item: T; col: number }[] = []
  let clusterEnd = -1

  const flush = (): void => {
    const colEnds: number[] = []
    for (const entry of cluster) {
      // Первая колонка, освободившаяся к началу занятия; иначе — новая колонка.
      let ci = colEnds.findIndex((end) => end <= entry.item.startMin)
      if (ci === -1) {
        ci = colEnds.length
        colEnds.push(entry.item.endMin)
      } else {
        colEnds[ci] = entry.item.endMin
      }
      entry.col = ci
    }
    const cols = colEnds.length
    for (const entry of cluster) result.push({ item: entry.item, col: entry.col, cols })
    cluster = []
  }

  for (const item of sorted) {
    if (cluster.length === 0) {
      cluster.push({ item, col: 0 })
      clusterEnd = item.endMin
    } else if (item.startMin >= clusterEnd) {
      flush()
      cluster.push({ item, col: 0 })
      clusterEnd = item.endMin
    } else {
      cluster.push({ item, col: 0 })
      clusterEnd = Math.max(clusterEnd, item.endMin)
    }
  }
  if (cluster.length) flush()

  return result
}
