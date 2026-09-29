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
