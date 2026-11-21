/**
 * Склейка запросов ссылок на вложения в пачки.
 *
 * Лента чата держит до двухсот строк, и каждое вложение просит свою ссылку. По запросу на
 * файл быстрая прокрутка медиа-чата упиралась в общий лимит API, поэтому просьбы за короткое
 * окно (кадр-другой) собираются и уходят одним запросом. Вызывающему это не видно: он, как
 * и раньше, получает обещание ссылки на свой файл, а кэш react-query остаётся поштучным.
 */

/** Сервер не отдал ссылку на этот файл: нет доступа, файл удалён или не существует. */
export class LinkMissingError extends Error {
  constructor(readonly id: string) {
    super(`Нет ссылки для ${id}`)
    this.name = 'LinkMissingError'
  }
}

export interface LinkBatcherOptions<T> {
  /** Один запрос за пачку id. Чего нет в ответе — тому вызывающему ошибка. */
  fetchMany: (ids: string[]) => Promise<Map<string, T>>
  /** Потолок пачки — столько же принимает сервер. Больше — уходит несколькими запросами. */
  maxBatch?: number
  /** Сколько ждать соседей, прежде чем отправить пачку. */
  windowMs?: number
}

interface Waiter<T> {
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

export function createLinkBatcher<T>({
  fetchMany,
  maxBatch = 50,
  windowMs = 20,
}: LinkBatcherOptions<T>): (id: string) => Promise<T> {
  // Map сохраняет порядок вставки — пачки идут в том порядке, в каком просили.
  let pending = new Map<string, Waiter<T>[]>()
  let timer: ReturnType<typeof setTimeout> | null = null

  function send(ids: string[], waiters: Map<string, Waiter<T>[]>): void {
    fetchMany(ids).then(
      (links) => {
        for (const id of ids) {
          const link = links.get(id)
          for (const w of waiters.get(id) ?? []) {
            if (link === undefined) w.reject(new LinkMissingError(id))
            else w.resolve(link)
          }
        }
      },
      (error: unknown) => {
        for (const id of ids) for (const w of waiters.get(id) ?? []) w.reject(error)
      },
    )
  }

  function flush(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    const batch = pending
    pending = new Map()
    const ids = [...batch.keys()]
    for (let i = 0; i < ids.length; i += maxBatch) send(ids.slice(i, i + maxBatch), batch)
  }

  return (id) =>
    new Promise<T>((resolve, reject) => {
      const waiters = pending.get(id)
      // Один и тот же файл дважды за окно (миниатюра и просмотрщик) — один id в запросе.
      if (waiters) waiters.push({ resolve, reject })
      else pending.set(id, [{ resolve, reject }])
      // Набралась полная пачка — ждать соседей незачем.
      if (pending.size >= maxBatch) flush()
      else if (timer === null) timer = setTimeout(flush, windowMs)
    })
}
