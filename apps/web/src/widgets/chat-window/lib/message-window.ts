// Окно истории ленты — как в Telegram Web: в DOM живёт ограниченный кусок переписки, догрузка
// начинается заранее, за несколько экранов до края, а дальний от человека край окна
// обрезается, чтобы после долгой прокрутки в ленте не копились тысячи пузырей.
//
// Здесь — чистая арифметика окна: размеры страниц, порог предзагрузки и обрезка с курсором
// на месте отрезанного куска. DOM и прокрутка — в ui/message-window.tsx.

export type ScrollAlign = 'start' | 'center' | 'end' | 'nearest'

/**
 * Управление лентой снаружи. Координаты — в пространстве содержимого прокрутки (0 — самый
 * верх), как у прежнего виртуализатора: `scrollOffset` — это `scrollTop`.
 */
export interface MessageWindowHandle {
  /** Текущая прокрутка ленты. */
  readonly scrollOffset: number
  /** Видимая высота ленты без нижнего отступа (место под панелью ввода). */
  readonly viewportSize: number
  /** Индекс строки, на которую приходится отступ. */
  findItemIndex: (offset: number) => number
  /** Верхний край строки. */
  getItemOffset: (index: number) => number
  /** Прокрутить к строке. */
  scrollToIndex: (index: number, opts?: { align?: ScrollAlign; smooth?: boolean }) => void
  /** Встать в самый низ ленты (без анимации). */
  scrollToBottom: () => void
}

/**
 * Сколько сообщений приносит одна догрузка. Telegram на больших экранах берёт 60, но API
 * отдаёт не больше 50 за запрос (CursorPaginationSchema).
 */
export const HISTORY_PAGE = 50

/**
 * Сколько сообщений держим в ленте. Telegram держит две страницы; у нас четыре: прокрутку
 * назад после догрузки человек делает часто, и обрезанный только что кусок не должен
 * приезжать заново по сети.
 */
export const WINDOW_LIMIT = HISTORY_PAGE * 4

/** Пауза перед повтором догрузки после неудачи (сеть, лимит запросов API). */
export const HISTORY_RETRY_MS = 2000

/** Минимальная дистанция до края, с которой начинается догрузка (px). */
const PRELOAD_MIN_PX = 1200
/** Сколько экранов вперёд держим загруженными. */
const PRELOAD_SCREENS = 3

/**
 * За сколько пикселей до края ленты начинать догрузку. Telegram держит зону 750px и берёт
 * историю из локальной базы; у нас каждая страница — запрос к серверу, поэтому зона шире:
 * три экрана — это примерно полсекунды быстрой прокрутки колесом, больше, чем идёт запрос.
 */
export function preloadDistance(viewportHeight: number): number {
  return Math.max(PRELOAD_MIN_PX, Math.round(viewportHeight * PRELOAD_SCREENS))
}

interface WindowRow {
  id: string
}

/** Временный id своего ещё не подтверждённого сообщения (оптимистичный пузырь). */
function isPending(row: WindowRow): boolean {
  return row.id.startsWith('tmp:')
}

export interface Trimmed<T> {
  list: T[]
  /**
   * Курсор на месте отрезанного края: id крайнего оставшегося сообщения. `undefined` — резать
   * не пришлось, окно и курсоры прежние.
   */
  cursor?: string
}

/**
 * Окно разрослось после догрузки СТАРЫХ — отрезаем самые новые. Человек сейчас наверху, низ
 * переписки он увидит, только пролистав всё окно обратно, а к тому времени низ подгрузится
 * заново (`direction: 'newer'` от курсора).
 *
 * Свои недоотправленные сообщения не режем: подтверждение сервера заменяет пузырь по
 * временному id, и отрезанный пузырь пропал бы насовсем.
 */
export function trimNewest<T extends WindowRow>(
  list: readonly T[],
  limit = WINDOW_LIMIT,
): Trimmed<T> {
  if (list.length <= limit) return { list: list as T[] }
  const tail = list.slice(limit)
  if (tail.some(isPending)) return { list: list as T[] }
  const kept = list.slice(0, limit)
  return { list: kept, cursor: kept[kept.length - 1]?.id }
}

/** Окно разрослось после догрузки НОВЫХ — отрезаем самые старые. */
export function trimOldest<T extends WindowRow>(
  list: readonly T[],
  limit = WINDOW_LIMIT,
): Trimmed<T> {
  if (list.length <= limit) return { list: list as T[] }
  const kept = list.slice(list.length - limit)
  return { list: kept, cursor: kept[0]?.id }
}

/**
 * Индекс строки, на которую приходится отступ `offset`, по отсортированным верхним краям
 * строк. Левее первой — 0, ниже последней — последняя. Двоичный поиск: в окне сотни строк,
 * а зовётся это на каждом кадре прокрутки.
 */
export function indexAtOffset(tops: readonly number[], offset: number): number {
  if (tops.length === 0) return -1
  let lo = 0
  let hi = tops.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if ((tops[mid] ?? 0) <= offset) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * Куда прокрутить контейнер, чтобы строка встала по `align`. Координаты — в пространстве
 * содержимого ленты (0 — самый верх прокрутки); результат зажат в допустимый диапазон.
 */
export function scrollTargetFor(
  row: { top: number; height: number },
  view: { scrollTop: number; height: number; maxScroll: number },
  align: 'start' | 'center' | 'end' | 'nearest',
): number {
  let target: number
  switch (align) {
    case 'start':
      target = row.top
      break
    case 'end':
      target = row.top + row.height - view.height
      break
    case 'center':
      target = row.top + row.height / 2 - view.height / 2
      break
    default: {
      const bottom = row.top + row.height
      if (row.top >= view.scrollTop && bottom <= view.scrollTop + view.height) {
        target = view.scrollTop
      } else if (row.top < view.scrollTop) target = row.top
      else target = bottom - view.height
    }
  }
  return Math.min(Math.max(0, Math.round(target)), Math.max(0, view.maxScroll))
}
