'use client'

import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { useTranslations } from 'next-intl'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from './button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'
import { Skeleton } from './skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'
import { cn } from '../lib/utils'

// Базовая таблица проекта. Пять свойств, которых не было в ручной вёрстке:
//   1) скроллится `tbody` (`Table scrollBody`) — шапка стоит НАД полосой прокрутки, а не
//      уезжает под неё, и строки не проезжают под заголовками;
//   2) шапка отличается поверхностью (`bg-muted`) — видно, что это не первая строка данных;
//   3) сортировка по любой колонке (`TableHead sortKey` + `useTableSort`);
//   4) своя ширина колонки (`cols` у `Table` + `Table fixed`);
//   5) не влезшее значение — `TableText`: обрезка, а на наведении полный текст с копированием.
//
// Липкость задана на `th`, а не на `thead`: sticky на группе строк Safari игнорирует.
// Нижняя граница шапки — inset-тень, а не `border-b`: при `border-collapse` граница
// принадлежит соседней строке и уезжает вместе с ней при скролле.

/**
 * Скролл-контейнер для двумерных таблиц (матрица журнала оценок): прокрутка сразу по двум
 * осям, шапка и первая колонка держатся на `sticky`. Обычным спискам он не нужен — там
 * скроллится `tbody` (`Table scrollBody`).
 */
export function TableScroll({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="table-scroll"
      className={cn('max-h-[60vh] overflow-auto overscroll-contain', className)}
      {...props}
    />
  )
}

// Ширины колонок раздаются через CSS-переменные `--col-N`: в режиме scrollBody шапка и
// каждая строка тела — отдельные таблицы, и `width` у `th` на строки тела уже не влияет
// (они делили бы ширину равномерно, из-за чего заголовок и значение расходятся). Селекторы
// статические — Tailwind не умеет генерировать nth-child на ходу; десяти колонок хватает
// всем таблицам проекта, лишние переменные просто не заданы (`auto`).
const COL_WIDTHS = [
  '[&_tr>*:nth-child(1)]:w-[var(--col-1,auto)]',
  '[&_tr>*:nth-child(2)]:w-[var(--col-2,auto)]',
  '[&_tr>*:nth-child(3)]:w-[var(--col-3,auto)]',
  '[&_tr>*:nth-child(4)]:w-[var(--col-4,auto)]',
  '[&_tr>*:nth-child(5)]:w-[var(--col-5,auto)]',
  '[&_tr>*:nth-child(6)]:w-[var(--col-6,auto)]',
  '[&_tr>*:nth-child(7)]:w-[var(--col-7,auto)]',
  '[&_tr>*:nth-child(8)]:w-[var(--col-8,auto)]',
  '[&_tr>*:nth-child(9)]:w-[var(--col-9,auto)]',
  '[&_tr>*:nth-child(10)]:w-[var(--col-10,auto)]',
].join(' ')

export function Table({
  className,
  fixed = false,
  scrollBody = false,
  fill = false,
  cols,
  style,
  ...props
}: ComponentProps<'table'> & {
  /**
   * Фиксированная раскладка: ширины колонок берутся из `cols`, а не из содержимого. Обязательна там, где значения обрезаются — при `auto` длинная
   * строка распирает колонку вместо обрезки. Матрицы (журнал оценок) — без неё.
   */
  fixed?: boolean
  /**
   * Прокрутка внутри `tbody`: шапка остаётся над полосой прокрутки, строки под неё не
   * заезжают. Высоту задаёт `max-h-*` у `TableBody` (по умолчанию `max-h-[60vh]`).
   */
  scrollBody?: boolean
  /**
   * Занять всю свободную высоту (вместо `max-h-*`): таблица доходит до низа области
   * контента, но строки остаются нормальной высоты — короткий список не растягивается
   * на весь экран, под ним просто остаётся свободное место карточки.
   * Требует flex-цепочки до `main`: у обёртки страницы и у `Card` — `flex min-h-0 flex-1`.
   */
  fill?: boolean
  /**
   * Ширины колонок по порядку — CSS-значения (`'12%'`, `'8rem'`). Задаются на таблице, а не
   * на отдельной ячейке шапки: только так одна и та же ширина достаётся и шапке, и строкам
   * тела, которые в режиме `scrollBody` являются отдельными таблицами.
   */
  cols?: readonly string[]
}) {
  const ref = useRef<HTMLTableElement>(null)
  // Полоса прокрутки съедает ширину только у `tbody`, поэтому шапка без компенсации
  // оказывается шире тела и колонки расходятся. Ширину полосы даёт сам браузер —
  // измеряем её и отдаём в `--table-gutter`, из которого шапка вычитает свою ширину.
  const [gutter, setGutter] = useState(0)
  useEffect(() => {
    if (!scrollBody) return
    const body = ref.current?.querySelector('tbody')
    if (!body) return
    const measure = (): void => setGutter(body.offsetWidth - body.clientWidth)
    measure()
    // Строк стало больше/меньше — полоса появляется и исчезает, ширину надо пересчитать.
    const observer = new ResizeObserver(measure)
    observer.observe(body)
    return () => observer.disconnect()
  }, [scrollBody])

  return (
    <table
      ref={ref}
      data-slot="table"
      style={{
        ...style,
        ['--table-gutter' as string]: `${gutter}px`,
        ...Object.fromEntries((cols ?? []).map((w, i) => [`--col-${i + 1}`, w])),
      }}
      className={cn(
        'w-full text-left text-sm',
        fixed && 'table-fixed',
        cols && COL_WIDTHS,
        // `thead` и каждая строка `tbody` становятся самостоятельными таблицами — только так
        // `tbody` можно сделать скролл-контейнером, оставив шапку снаружи.
        scrollBody &&
          'block [&>tbody>tr]:table [&>tbody>tr]:w-full [&>tbody>tr]:table-fixed [&>thead]:table [&>thead]:table-fixed',
        scrollBody && !fill && '[&>tbody]:block',
        // Тело — flex-колонка на всю свободную высоту, но строки в ней своей высоты:
        // `shrink-0` не даёт им сжаться, когда строк больше, чем места (тогда скролл), и
        // никакого `grow` — десяток строк не должен раздуваться на весь экран.
        scrollBody &&
          fill &&
          'flex min-h-0 flex-1 flex-col [&>tbody]:flex [&>tbody]:min-h-0 [&>tbody]:max-h-none [&>tbody]:flex-1 [&>tbody]:flex-col [&>tbody>tr]:shrink-0',
        // Шапка на `calc(100% - полоса прокрутки)` оставляет справа от себя полоску шириной
        // полосы — «пустой угол». Заливка таблицы = цвет шапки, заливка тела = цвет карточки:
        // угол становится продолжением шапки, а строки остаются на своём фоне.
        scrollBody && 'bg-muted [&>tbody]:bg-card',
        className,
      )}
      {...props}
    />
  )
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      // Ширина минус полоса прокрутки `tbody` (вне режима scrollBody переменная = 0,
      // и ширина у группы строк всё равно игнорируется).
      className={cn(
        'w-[calc(100%-var(--table-gutter,0px))] text-sm text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      // max-h/overflow работают только когда родительская `Table` в режиме scrollBody;
      // у обычной группы строк браузер их игнорирует.
      className={cn(
        'max-h-[60vh] divide-y divide-border overflow-y-auto overscroll-contain',
        className,
      )}
      {...props}
    />
  )
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return <tr data-slot="table-row" className={className} {...props} />
}

export interface TableHeadProps extends Omit<ComponentProps<'th'>, 'onClick'> {
  /**
   * Числовая колонка: заголовок прижимается вправо, к самим числам.
   * Одним `text-right` этого не добиться — у сортируемого заголовка внутри `th` лежит
   * кнопка `flex w-full`, и выравнивание текста ячейки на неё не действует: подпись
   * оставалась у левого края колонки, а числа стояли у правого.
   */
  numeric?: boolean
  /** Ключ сортировки. Задан — заголовок становится кнопкой сортировки. */
  sortKey?: string
  /** Текущая сортировка таблицы (из `useTableSort`). */
  sort?: SortState | null
  onSort?: (key: string) => void
}

/**
 * Ячейка шапки: липнет к верху скролл-контейнера, поверхность `bg-muted` — шапка
 * читается как шапка, а не как первая строка данных.
 */
export function TableHead({
  className,
  sortKey,
  sort,
  onSort,
  numeric = false,
  children,
  ...props
}: TableHeadProps) {
  const active = sortKey != null && sort?.key === sortKey
  const dir = active ? sort!.dir : null
  const Icon = dir === 'asc' ? ArrowUp : dir === 'desc' ? ArrowDown : ArrowUpDown

  return (
    <th
      data-slot="table-head"
      aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}
      className={cn(
        'sticky top-0 z-10 bg-muted px-4 py-2 font-semibold shadow-[inset_0_-1px_0_var(--border)]',
        numeric && 'text-right',
        className,
      )}
      {...props}
    >
      {sortKey != null && onSort ? (
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className={cn(
            // Кнопка во всю ширину ячейки — кликабелен весь заголовок, а не только текст.
            'flex w-full cursor-pointer items-center gap-1 transition-colors hover:text-foreground',
            numeric ? 'justify-end text-right' : 'text-left',
            active && 'text-foreground',
          )}
        >
          <span className="truncate">{children}</span>
          <Icon className={cn('size-3.5 shrink-0', !active && 'opacity-40')} aria-hidden />
        </button>
      ) : (
        children
      )}
    </th>
  )
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td data-slot="table-cell" className={cn('px-4 py-2', className)} {...props} />
}

/**
 * Отсутствующее значение в ячейке: слово «пусто», а не прочерк. Прочерк читается и как
 * «нет данных», и как настоящее значение (минус, диапазон), а скринридер его пропускает.
 * Правило общее для всех таблиц (DESIGN_SYSTEM §10.7).
 */
export function TableEmpty({ className }: { className?: string }) {
  const t = useTranslations('Table')
  return <span className={cn('text-muted-foreground', className)}>{t('empty')}</span>
}

/**
 * Значение в одну строку: не влезло — обрезается, а на наведении показывает полный
 * текст с кнопкой «Копировать» (подсказка hoverable, текст в ней можно выделить).
 * Подсказка появляется только у реально обрезанных значений — иначе она мешала бы
 * на каждой ячейке. Пустое значение (`null`, `''`) — это `TableEmpty`.
 */
export function TableText({
  value,
  className,
}: {
  value: string | null | undefined
  className?: string
}) {
  const t = useTranslations('Table')
  const ref = useRef<HTMLSpanElement>(null)
  const [clipped, setClipped] = useState(false)

  // Проверяем на входе курсора/фокуса, а не в эффекте: ширина колонки зависит от
  // раскладки таблицы, и на момент монтирования она ещё не финальная.
  function check(): void {
    const el = ref.current
    if (el) setClipped(el.scrollWidth > el.clientWidth + 1)
  }

  function copy(): void {
    navigator.clipboard.writeText(value ?? '').then(
      () => toast.success(t('copied')),
      () => toast.error(t('copyFailed')),
    )
  }

  // Проверка после хуков: порядок хуков не должен зависеть от значения ячейки.
  if (value == null || value.trim() === '') return <TableEmpty className={className} />

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          ref={ref}
          onMouseEnter={check}
          onFocus={check}
          tabIndex={clipped ? 0 : undefined}
          className={cn('block truncate', className)}
        >
          {value}
        </span>
      </TooltipTrigger>
      {clipped && (
        <TooltipContent className="max-w-sm">
          <div className="flex items-start gap-2">
            <span className="break-all select-text">{value}</span>
            <button
              type="button"
              onClick={copy}
              aria-label={t('copy')}
              className="shrink-0 cursor-pointer rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
            >
              <Copy className="size-3.5" aria-hidden />
            </button>
          </div>
        </TooltipContent>
      )}
    </Tooltip>
  )
}

/**
 * Строки-заглушки на время загрузки. Таблица при этом рендерится целиком: шапка, ширины
 * колонок и подвал на месте, меняется только содержимое строк — экран не «прыгает», когда
 * данные приходят (FRONTEND_RULES: скелетон повторяет геометрию контента).
 */
/**
 * Скелетон строк на время загрузки.
 *
 * `columns` — либо число колонок, либо их классы видимости по порядку. Второе нужно
 * таблицам, которые прячут часть колонок на узком экране: скелетон обязан скрывать те
 * же самые, иначе во время загрузки строк оказывается больше ячеек, чем в шапке, и
 * колонки разъезжаются.
 */
export function TableSkeletonRows({
  columns,
  rows = 8,
}: {
  columns: number | readonly (string | undefined)[]
  rows?: number
}) {
  const cells = typeof columns === 'number' ? Array.from<undefined>({ length: columns }) : columns
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <TableRow key={r}>
          {cells.map((cls, c) => (
            <TableCell key={c} className={cls}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  )
}

// ── Сортировка ───────────────────────────────────────────────────────────────

export type SortDirection = 'asc' | 'desc'
export interface SortState {
  key: string
  dir: SortDirection
}

/** Следующее состояние по клику: asc → desc → без сортировки. */
export function nextSort(sort: SortState | null, key: string): SortState | null {
  if (sort?.key !== key) return { key, dir: 'asc' }
  return sort.dir === 'asc' ? { key, dir: 'desc' } : null
}

const isEmpty = (v: unknown): boolean => v == null || v === ''

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  // numeric: 'Группа 2' < 'Группа 10', а не наоборот по кодам символов.
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

/** Сортировка строк по значению колонки. Исходный массив не меняется. */
export function sortRows<T>(
  rows: T[],
  sort: SortState | null,
  value: (row: T, key: string) => unknown,
): T[] {
  if (!sort) return rows
  const sign = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = value(a, sort.key)
    const bv = value(b, sort.key)
    // Пустые — всегда в конце, в обоих направлениях: иначе разворот сортировки
    // поднимает наверх страницу прочерков вместо данных.
    if (isEmpty(av) || isEmpty(bv)) {
      return isEmpty(av) && isEmpty(bv) ? 0 : isEmpty(av) ? 1 : -1
    }
    return sign * compare(av, bv)
  })
}

/**
 * Только состояние сортировки, без пересортировки данных: порядок задаёт сервер
 * (`sort`/`order` в запросе). Для серверных списков — этот хук, иначе сортировалась бы
 * лишь открытая страница.
 */
export function useSortState(initial: SortState | null = null): {
  sort: SortState | null
  toggle: (key: string) => void
} {
  const [sort, setSort] = useState<SortState | null>(initial)
  return { sort, toggle: (key) => setSort((s) => nextSort(s, key)) }
}

/**
 * Состояние сортировки + сортировка на клиенте. Только для данных, которые уже целиком
 * на клиенте (предпросмотр импорта, матрица журнала). `value` обязан быть стабильным
 * (объявлен вне компонента), иначе пересортировка на каждый рендер.
 */
/**
 * Состояние серверной таблицы: страница, размер и порядок в одном месте.
 *
 * `query` отдаётся готовым к отправке — его же кладут в ключ кэша. Смена сортировки
 * и размера страницы сбрасывает на первую: иначе пользователь остаётся на пятой
 * странице заново упорядоченного списка, а при большом размере её может уже не быть.
 */
export function usePagedSort<S extends string = string>(
  initialLimit = 20,
): {
  page: number
  limit: number
  sort: SortState | null
  toggle: (key: string) => void
  setPage: (page: number) => void
  setLimit: (limit: number) => void
  query: { page: number; limit: number; sort?: S; order?: SortDirection }
} {
  const [page, setPage] = useState(1)
  const [limit, setLimitRaw] = useState(initialLimit)
  const [sort, setSort] = useState<SortState | null>(null)

  return {
    page,
    limit,
    sort,
    toggle: (key) => {
      setSort((s) => nextSort(s, key))
      setPage(1)
    },
    setPage,
    setLimit: (next) => {
      setLimitRaw(next)
      setPage(1)
    },
    // Ключ колонки приходит из sortKey заголовка — он же значение серверного enum.
    // Параметр S сужает тип до допустимых колонок конкретного списка.
    query: { page, limit, ...(sort ? { sort: sort.key as S, order: sort.dir } : {}) },
  }
}

export function useTableSort<T>(
  rows: T[],
  value: (row: T, key: string) => unknown,
  initial: SortState | null = null,
): { rows: T[]; sort: SortState | null; toggle: (key: string) => void } {
  const [sort, setSort] = useState<SortState | null>(initial)
  const sorted = useMemo(() => sortRows(rows, sort, value), [rows, sort, value])
  return { rows: sorted, sort, toggle: (key) => setSort((s) => nextSort(s, key)) }
}

// ── Пагинация ────────────────────────────────────────────────────────────────

/**
 * Номера страниц для переключателя: первая, последняя, окно вокруг текущей,
 * между ними — пропуски. Без окна кнопок было бы столько же, сколько страниц.
 */
export function pageItems(current: number, pages: number, span = 1): (number | 'gap')[] {
  const shown = new Set<number>([1, pages])
  for (let p = current - span; p <= current + span; p++) {
    if (p >= 1 && p <= pages) shown.add(p)
  }
  const out: (number | 'gap')[] = []
  let prev = 0
  for (const p of [...shown].sort((a, b) => a - b)) {
    // Пропуск ставим только если он скрывает больше одной страницы: «1 … 3 4» вместо
    // «1 2 3 4» — это подмена номера многоточием той же ширины, без всякой выгоды.
    if (p - prev === 2) out.push(p - 1)
    else if (prev > 0 && p - prev > 1) out.push('gap')
    out.push(p)
    prev = p
  }
  return out
}

export interface TablePaginationProps {
  /** Текущая страница, с единицы. */
  page: number
  /** Всего строк во всей выборке (не на странице) — из `meta.total` ответа. */
  total: number
  /** Размер страницы. */
  limit: number
  onPageChange: (page: number) => void
  /**
   * Варианты размера страницы. Заданы вместе с `onLimitChange` — в подвале появляется
   * селектор «на странице». Предел серверной схемы — 200 строк.
   */
  limitOptions?: readonly number[]
  onLimitChange?: (limit: number) => void
  className?: string
}

/** Подвал таблицы: сколько всего строк, размер страницы, номера страниц и переход по ним. */
export function TablePagination({
  page,
  total,
  limit,
  onPageChange,
  limitOptions,
  onLimitChange,
  className,
}: TablePaginationProps) {
  const t = useTranslations('Table')
  const pages = Math.max(1, Math.ceil(total / limit))
  const current = Math.min(Math.max(page, 1), pages)

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-sm text-muted-foreground',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span className="tabular-nums">
          {t('rows', { count: total })} · {t('page', { page: current, pages })}
        </span>
        {limitOptions && onLimitChange && (
          <label className="flex items-center gap-2">
            <span className="whitespace-nowrap">{t('perPage')}</span>
            <Select value={String(limit)} onValueChange={(v) => onLimitChange(Number(v))}>
              <SelectTrigger className="h-8 w-[4.75rem] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {limitOptions.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon
          aria-label={t('prev')}
          disabled={current <= 1}
          onClick={() => onPageChange(current - 1)}
        >
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        {pageItems(current, pages).map((item, i) =>
          item === 'gap' ? (
            <span key={`gap-${i}`} className="px-1 opacity-60" aria-hidden>
              …
            </span>
          ) : (
            <Button
              key={item}
              type="button"
              variant={item === current ? 'default' : 'ghost'}
              size="sm"
              icon
              aria-label={t('goToPage', { page: item })}
              aria-current={item === current ? 'page' : undefined}
              className="tabular-nums"
              onClick={() => onPageChange(item)}
            >
              {item}
            </Button>
          ),
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon
          aria-label={t('next')}
          disabled={current >= pages}
          onClick={() => onPageChange(current + 1)}
        >
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  )
}
