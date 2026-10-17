/**
 * Склейка перезапросов, которые просят события реального времени (F-F02).
 *
 * Одно сообщение в чате приходит к человеку несколькими событиями сразу — `message:new`
 * в комнату открытого чата, `chat:activity` в личную, следом `notification:new`, — а в
 * живой группе они идут потоком. Перезапрос на каждое значил десятки одинаковых запросов в
 * секунду от каждого участника. Здесь все просьбы за короткое окно сливаются в один запуск.
 */
export interface RefreshCoalescer {
  /** Обновить не позже чем через `delayMs`. Уже назначенный более ранний запуск не сдвигается. */
  soon(delayMs: number): void
  /**
   * Обновить, когда события затихнут на `delayMs`: каждое новое отодвигает запуск, но не
   * дальше `maxWaitMs` от первого, — поток событий не откладывает обновление навсегда.
   * Назначенное «скоро» не отодвигает.
   */
  settle(delayMs: number): void
  /** Снять назначенный запуск (размонтирование). */
  cancel(): void
}

export interface RefreshCoalescerOptions {
  /** Не чаще одного запуска за этот интервал. */
  minIntervalMs?: number
  /** Потолок ожидания для `settle`. */
  maxWaitMs?: number
}

export function createRefreshCoalescer(
  run: () => unknown,
  { minIntervalMs = 0, maxWaitMs = 5000 }: RefreshCoalescerOptions = {},
): RefreshCoalescer {
  let timer: ReturnType<typeof setTimeout> | null = null
  let due = 0
  let firstAt = 0
  // Назначенный запуск — «когда затихнет» (его можно отодвигать) или «скоро» (нельзя).
  let settling = false
  let running = false
  // Срок вышел, пока шёл прошлый запуск: события после его начала он мог не увидеть.
  let rerun = false
  let lastRunAt = Number.NEGATIVE_INFINITY

  function arm(at: number): void {
    const when = Math.max(at, lastRunAt + minIntervalMs)
    if (timer !== null) clearTimeout(timer)
    due = when
    timer = setTimeout(fire, Math.max(0, when - Date.now()))
  }

  function fire(): void {
    timer = null
    settling = false
    if (running) {
      rerun = true
      return
    }
    running = true
    lastRunAt = Date.now()
    void Promise.resolve()
      .then(run)
      .catch(() => undefined)
      .finally(() => {
        running = false
        if (!rerun) return
        rerun = false
        if (timer === null) {
          firstAt = Date.now()
          arm(firstAt)
        }
      })
  }

  return {
    soon(delayMs) {
      const now = Date.now()
      if (timer === null) {
        firstAt = now
        settling = false
        arm(now + delayMs)
        return
      }
      settling = false
      if (now + delayMs < due) arm(now + delayMs)
    },
    settle(delayMs) {
      const now = Date.now()
      if (timer === null) {
        firstAt = now
        settling = true
        arm(now + delayMs)
        return
      }
      if (!settling) return
      arm(Math.min(now + delayMs, firstAt + maxWaitMs))
    },
    cancel() {
      if (timer !== null) clearTimeout(timer)
      timer = null
      settling = false
      rerun = false
    },
  }
}
