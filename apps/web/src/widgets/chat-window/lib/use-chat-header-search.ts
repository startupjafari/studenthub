'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { chatKeys, searchMessages, type ChatMessage } from '../../../entities/chat'
import { EMPTY_DAY_RANGE, dayRangeToIso, hasDayRange, type SearchDayRange } from './search-range'

/** Короче сервер текст не ищет (`MessageSearchQuerySchema.q.min(2)`). */
export const CHAT_SEARCH_MIN_CHARS = 2
const SEARCH_DEBOUNCE_MS = 300
/**
 * За сколько совпадений до конца загруженной выдачи подтягивать следующую страницу. Шаг
 * стрелкой не должен упираться в «грузится»: к последнему загруженному совпадению
 * следующая страница уже на месте.
 */
const PREFETCH_TAIL = 5

export interface ChatSearchSender {
  id: string
  name: string
}

/**
 * Поиск внутри открытого чата — состояние и навигация (Telegram: шапка переписки).
 *
 * Вынесено из окна чата целиком: поле, автор-фильтр, выдача страницами и номер текущего
 * совпадения живут вместе и меняются вместе, а окну нужно только «открыт ли поиск» и «что
 * подсветить в ленте».
 *
 * Порядок как в Telegram: выдача идёт от новых к старым (так её отдаёт сервер), номер −1 —
 * «ещё ни к одному не переходили». «Старее» (↑) — следующее по выдаче, «новее» (↓) —
 * предыдущее. Сразу после ответа сервера лента никуда не прыгает: человек сначала видит
 * список и сам выбирает, куда идти.
 *
 * Искать можно и без слов, как в Telegram: выбранный автор («От: …») сам по себе показывает
 * все его сообщения, выбранный период — все сообщения за эти дни. Слова, автор и период
 * сужают выдачу вместе.
 */
export function useChatHeaderSearch({
  chatId,
  jumpToMessage,
}: {
  chatId: string | null
  jumpToMessage: (messageId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState('')
  const [term, setTerm] = useState('')
  const [sender, setSender] = useState<ChatSearchSender | null>(null)
  // Период (дни в поясе смотрящего) и открыт ли выбор периода под шапкой.
  const [range, setRangeState] = useState<SearchDayRange>(EMPTY_DAY_RANGE)
  const [pickingRange, setPickingRange] = useState(false)
  // Выбор автора (Telegram «От: …»): поле ввода фильтрует участников, а запрос по
  // сообщениям тем временем лежит нетронутым и вернётся, когда автора выберут.
  const [pickingSender, setPickingSender] = useState(false)
  const [memberQuery, setMemberQuery] = useState('')
  const [index, setIndex] = useState(-1)
  const [listOpen, setListOpen] = useState(true)
  // Растёт при каждом «открыть поиск» — поле ловит его и забирает фокус, даже если поиск
  // уже был открыт (повторный Ctrl+F).
  const [focusTick, setFocusTick] = useState(0)

  const jumpRef = useRef(jumpToMessage)
  jumpRef.current = jumpToMessage

  useEffect(() => {
    const value = raw.trim()
    const id = window.setTimeout(() => {
      setTerm(value.length >= CHAT_SEARCH_MIN_CHARS ? value : '')
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [raw])

  // Новый запрос, автор или период — выдача другая: номер сбрасывается, список снова раскрыт.
  useEffect(() => {
    setIndex(-1)
    setListOpen(true)
  }, [term, sender?.id, range.from, range.to])

  const close = useCallback(() => {
    setOpen(false)
    setRaw('')
    setTerm('')
    setSender(null)
    setPickingSender(false)
    setMemberQuery('')
    setRangeState(EMPTY_DAY_RANGE)
    setPickingRange(false)
    setIndex(-1)
    setListOpen(true)
  }, [])

  // Поиск принадлежит чату: открыв соседний, человек не должен увидеть в шапке чужой запрос.
  useEffect(() => {
    close()
  }, [chatId, close])

  const openSearch = useCallback(() => {
    setOpen(true)
    setListOpen(true)
    setFocusTick((n) => n + 1)
  }, [])

  // Ctrl/⌘+F в открытом чате ищет по переписке, а не по странице браузера: в DOM только
  // видимый кусок ленты (виртуализация), и браузерный поиск «где это было» не найдёт.
  // Из поля ввода сообщения сочетание не перехватываем, пока поиск закрыт: там это
  // привычный поиск браузера по набранному.
  useEffect(() => {
    if (!chatId) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() !== 'f' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
      const el = document.activeElement
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      if (typing && !open) return
      e.preventDefault()
      openSearch()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chatId, open, openSearch])

  const bounds = useMemo(() => dayRangeToIso(range), [range])
  const hasRange = hasDayRange(range)
  // Есть что искать: слова, автор или период — каждое само по себе (Telegram: «От: Анна»
  // без слов показывает все её сообщения).
  const active = term.length >= CHAT_SEARCH_MIN_CHARS || !!sender || hasRange

  const query = useInfiniteQuery({
    queryKey: chatKeys.searchInChat(chatId ?? '', term, sender?.id, bounds.from, bounds.to),
    queryFn: ({ pageParam }) =>
      searchMessages(term, chatId as string, pageParam, {
        senderId: sender?.id,
        from: bounds.from,
        to: bounds.to,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasNext ? last.cursor : undefined),
    enabled: open && !!chatId && active,
    // Повторный проход по тем же словам (закрыл, открыл) не должен ждать сеть.
    staleTime: 30_000,
  })

  const results: ChatMessage[] = useMemo(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  )
  const lastPage = query.data?.pages[query.data.pages.length - 1]
  // Сервер считает все совпадения; без его числа (старый сервер) — сколько уже пришло.
  const total = Math.max(lastPage?.total ?? 0, results.length)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query

  useEffect(() => {
    if (index < 0 || !hasNextPage || isFetchingNextPage) return
    if (index >= results.length - PREFETCH_TAIL) void fetchNextPage()
  }, [index, results.length, hasNextPage, isFetchingNextPage, fetchNextPage])

  const goTo = useCallback((next: number, list: readonly ChatMessage[]) => {
    const m = list[next]
    if (!m) return
    setIndex(next)
    setListOpen(false)
    jumpRef.current(m.id)
  }, [])

  /** Выбрать совпадение из списка. */
  const pick = useCallback((i: number) => goTo(i, results), [goTo, results])

  /** ↑ — к более старому совпадению. На краю загруженного — дотягивает страницу. */
  const older = useCallback(async () => {
    if (index + 1 < results.length) {
      goTo(index + 1, results)
      return
    }
    if (!hasNextPage) return
    const res = await fetchNextPage()
    const list = res.data?.pages.flatMap((p) => p.items) ?? []
    goTo(index + 1, list)
  }, [index, results, hasNextPage, fetchNextPage, goTo])

  /** ↓ — к более новому совпадению. */
  const newer = useCallback(() => {
    if (index > 0) goTo(index - 1, results)
  }, [index, results, goTo])

  /** Текст поля: в режиме выбора автора он фильтрует участников. */
  const setInput = useCallback(
    (value: string) => {
      if (pickingSender) setMemberQuery(value)
      else setRaw(value)
    },
    [pickingSender],
  )

  const startPickSender = useCallback(() => {
    setPickingRange(false)
    setPickingSender(true)
    setMemberQuery('')
    setListOpen(true)
    setFocusTick((n) => n + 1)
  }, [])

  const chooseSender = useCallback((next: ChatSearchSender) => {
    setSender(next)
    setPickingSender(false)
    setMemberQuery('')
    setFocusTick((n) => n + 1)
  }, [])

  /** Снять фильтр «От» (крестик на метке или Backspace в пустом поле). */
  const clearSender = useCallback(() => {
    setSender(null)
    setPickingSender(false)
    setMemberQuery('')
    setFocusTick((n) => n + 1)
  }, [])

  /** Открыть или спрятать выбор периода под шапкой. */
  const toggleRangePicker = useCallback(() => {
    setPickingSender(false)
    setMemberQuery('')
    setPickingRange((v) => !v)
    setListOpen(true)
  }, [])

  /** Новый период. Обе границы выбраны — выбор прячется, под шапкой снова выдача. */
  const setRange = useCallback((next: SearchDayRange) => {
    setRangeState(next)
    if (next.from && next.to) setPickingRange(false)
  }, [])

  /** Снять период (крестик на метке). */
  const clearRange = useCallback(() => {
    setRangeState(EMPTY_DAY_RANGE)
    setPickingRange(false)
    setFocusTick((n) => n + 1)
  }, [])

  /**
   * Escape и «назад» в поле — по ступеням, как в Telegram: сперва выход из выбора автора или
   * периода, потом очистка запроса и фильтров, и только с пустым полем — закрыть поиск.
   */
  const escape = useCallback(() => {
    if (pickingSender) {
      setPickingSender(false)
      setMemberQuery('')
      return
    }
    if (pickingRange) {
      setPickingRange(false)
      return
    }
    if (raw || sender || hasRange) {
      setRaw('')
      setTerm('')
      setSender(null)
      setRangeState(EMPTY_DAY_RANGE)
      return
    }
    close()
  }, [pickingSender, pickingRange, raw, sender, hasRange, close])

  return {
    open,
    raw,
    term,
    /** Что подсветить в ленте: только то, что правда искали. */
    highlight: open && active ? term : '',
    input: pickingSender ? memberQuery : raw,
    sender,
    pickingSender,
    range,
    hasRange,
    pickingRange,
    memberQuery,
    results,
    total,
    index,
    listOpen,
    active,
    /** Первая страница едет: число совпадений ещё неизвестно. */
    loading: active && query.isLoading,
    fetching: active && query.isFetching,
    error: active && query.isError && results.length === 0,
    hasMore: !!hasNextPage,
    loadingMore: isFetchingNextPage,
    focusTick,
    canOlder: index + 1 < total,
    canNewer: index > 0,
    openSearch,
    close,
    escape,
    setInput,
    setListOpen,
    pick,
    older,
    newer,
    loadMore: () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
    },
    retry: () => void query.refetch(),
    startPickSender,
    chooseSender,
    clearSender,
    toggleRangePicker,
    setRange,
    clearRange,
  }
}

export type ChatHeaderSearchState = ReturnType<typeof useChatHeaderSearch>
