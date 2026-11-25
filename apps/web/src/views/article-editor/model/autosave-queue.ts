/**
 * Очередь сохранений черновика статьи — без React, чтобы порядок проверялся тестами.
 *
 * Сохранения идут строго по одному: пока летит одно, новые правки только запоминаются,
 * и после ответа уходит одно сохранение с самым свежим текстом. Поэтому медленный ответ
 * на старую версию не может лечь поверх новой (на сервере всегда последняя отправленная),
 * а первая правка новой статьи не создаёт её дважды.
 */
export type AutosaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

export interface AutosaveQueueOptions<T> {
  save: (value: T) => Promise<void>
  onState: (state: AutosaveState) => void
}

export class AutosaveQueue<T> {
  private latest: { value: T; key: string } | null = null
  private savedKey: string | null = null
  private inFlight: Promise<void> | null = null
  private stopped = false

  constructor(private readonly opts: AutosaveQueueOptions<T>) {}

  /** Отметить уже сохранённое (статья пришла с сервера) — его повторно не отправляем. */
  markSaved(key: string): void {
    this.savedKey = key
  }

  /** Запомнить новую версию; уйдёт при следующем `flush`. */
  push(value: T, key: string): void {
    if (this.stopped) return
    this.latest = { value, key }
    if (key !== this.savedKey && !this.inFlight) this.opts.onState('pending')
  }

  /** Отправить свежую версию, если она ещё не сохранена. Ждёт текущую отправку. */
  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight
    const next = this.latest
    if (this.stopped || !next || next.key === this.savedKey) return Promise.resolve()
    this.opts.onState('saving')
    this.inFlight = this.opts
      .save(next.value)
      .then(() => {
        this.savedKey = next.key
        this.inFlight = null
        // Пока летело, текст успели поправить — отправляем и это.
        if (this.latest && this.latest.key !== this.savedKey && !this.stopped) {
          return this.flush()
        }
        this.opts.onState('saved')
      })
      .catch(() => {
        this.inFlight = null
        this.opts.onState('error')
      })
    return this.inFlight
  }

  /**
   * Остановить автосохранение и дождаться отправки, если она летит: публикация не должна
   * разойтись с черновиком, который сохранится уже после неё и вернёт статью в черновики.
   */
  async stop(): Promise<void> {
    this.stopped = true
    await this.inFlight
  }

  resume(): void {
    this.stopped = false
  }
}
