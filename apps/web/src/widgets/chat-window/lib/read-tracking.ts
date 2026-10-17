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
