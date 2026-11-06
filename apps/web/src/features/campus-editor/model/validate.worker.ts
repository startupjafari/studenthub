import { validateFloor, type FloorPlanDoc } from '@studenthub/campus-core'

/**
 * Проверка этажа вне главного потока (§12.12): на большом этаже она занимает десятки
 * миллисекунд и дёргала бы перетаскивание. Ответ с устаревшим `seq` отбрасывает сам редактор.
 */
// Типы webworker не подключаем: в одной программе с DOM они конфликтуют.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null
  postMessage: (message: unknown) => void
}

scope.onmessage = (e: MessageEvent<{ seq: number; doc: FloorPlanDoc; floorHeightMm: number }>) => {
  const { seq, doc, floorHeightMm } = e.data
  scope.postMessage({ seq, problems: validateFloor(doc, { floorHeightMm }) })
}
