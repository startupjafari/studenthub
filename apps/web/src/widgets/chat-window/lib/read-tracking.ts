// Прочтение в ленте чата — как в Telegram: прочитанным становится то, что проехало через
// экран, а плашка «Непрочитанные сообщения» стоит перед первым из них.

interface Row {
  senderId: string | null
  createdAt: string
}

/**
 * Первое непрочитанное в загруженной ленте. Сервер отдаёт только число непрочитанных, и оно
 * считает лишь ЧУЖИЕ сообщения — поэтому и отсчёт с конца идёт по чужим. Раньше отсчитывали
 * все подряд, и собственные ответы сдвигали плашку «Непрочитанные» вглубь прочитанного.
 * Непрочитанного больше, чем загружено, — плашка на самом раннем загруженном.
 */
export function firstUnreadIndex(
  list: readonly Row[],
  unread: number,
  myId: string | undefined,
): number | null {
  if (unread <= 0) return null
  let seen = 0
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.senderId === myId) continue
    seen += 1
    if (seen === unread) return i
  }
  return seen > 0 ? 0 : null
}

/** Страница первичной загрузки ленты (и половина окна вокруг первого непрочитанного). */
export const OPEN_PAGE = 30

/** Что о непрочитанном чата знает элемент списка. `firstUnreadId` — у нового сервера. */
interface UnreadInfo {
  unreadCount: number
  firstUnreadId?: string | null
}

export type OpenAnchor = { kind: 'bottom' } | { kind: 'around'; messageId: string }

/**
 * Где открыть чат. Непрочитанных не меньше страницы — первое из них в последнюю страницу
 * точно не попадёт, и чат сразу грузится окном вокруг него (Telegram), а не низом истории
 * с плашкой на самом раннем из загруженного. Иначе — у низа, как раньше.
 */
export function openAnchor(chat: UnreadInfo | undefined, page: number): OpenAnchor {
  if (chat?.firstUnreadId && chat.unreadCount >= page) {
    return { kind: 'around', messageId: chat.firstUnreadId }
  }
  return { kind: 'bottom' }
}

/**
 * Первое непрочитанное не попало в загруженную последнюю страницу, а история старше есть:
 * чужих непрочитанных меньше страницы, но между ними много своих сообщений. Нужно окно
 * вокруг него.
 */
export function needsWindow(
  page: { items: readonly { id: string }[]; hasNext: boolean },
  firstUnreadId: string | null | undefined,
): boolean {
  return !!firstUnreadId && page.hasNext && !page.items.some((m) => m.id === firstUnreadId)
}

/**
 * Место плашки «Непрочитанные сообщения» в загруженной ленте: по id первого непрочитанного,
 * если сервер его прислал и оно загружено, иначе — отсчётом чужих сообщений с конца
 * (`firstUnreadIndex`).
 */
export function firstUnreadPosition(
  list: readonly (Row & { id: string })[],
  chat: UnreadInfo | undefined,
  myId: string | undefined,
): number | null {
  const unread = chat?.unreadCount ?? 0
  if (unread <= 0) return null
  if (chat?.firstUnreadId) {
    const at = list.findIndex((m) => m.id === chat.firstUnreadId)
    if (at >= 0) return at
  }
  return firstUnreadIndex(list, unread, myId)
}

/**
 * Сколько чужих сообщений новее отметки «прочитано до» — число на кнопке «вниз» и в списке
 * чатов. `readUpTo` пустой строкой — не прочитано ничего из загруженного; null — отметки
 * ещё нет (лента не открыта), считать нечего.
 */
export function unreadAfter(
  list: readonly Row[],
  readUpTo: string | null,
  myId: string | undefined,
): number {
  if (readUpTo === null) return 0
  let n = 0
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i]
    if (!m || m.createdAt <= readUpTo) break
    if (m.senderId !== myId) n += 1
  }
  return n
}

interface Receipt {
  id: string
  lastReadAt: string | null
}

/**
 * Применить прочтение участника к уже загруженным статусам «кто прочитал» — из самого
 * события `message:read`, без запроса.
 *
 * Раньше каждое чужое прочтение перезапрашивало `GET /chats/:id/reads` (до 500 строк) у
 * всех, кто держит чат открытым: в группе во время пары прочтения идут потоком, и это
 * давало N×M запросов (F-F22). Отметка только растёт — запоздавшее событие о более раннем
 * прочтении её не откатывает. Участника нет в списке — список не меняется: новичка
 * подтянет следующая загрузка, а придумывать ему строку без имени незачем.
 */
export function withReceipt<T extends Receipt>(list: T[], userId: string, readAt: string): T[] {
  let changed = false
  const next = list.map((r) => {
    if (r.id !== userId) return r
    if (r.lastReadAt && Date.parse(r.lastReadAt) >= Date.parse(readAt)) return r
    changed = true
    return { ...r, lastReadAt: readAt }
  })
  return changed ? next : list
}
