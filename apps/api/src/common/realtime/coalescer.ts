// Склейка частых событий в одно (эпик «всё живое по сокету», docs/PROJECT.md §9.2d).
//
// Лайк в вузе на тысячу человек — это событие в комнату на тысячу сокетов. Если каждый лайк
// уходит сразу, популярный пост за минуту рассылает сотни одинаковых сигналов «счётчики
// изменились». Коалесер копит изменения по ключу и отправляет последнее не чаще раза в окно:
// первое изменение ставит таймер, следующие в пределах окна только обновляют, что отправить.
//
// Состояние — в памяти процесса. С несколькими инстансами API каждый склеивает свои события
// сам; итог тот же — клиент получает «счётчики изменились» и перечитывает их, а не суммирует.

export class RealtimeCoalescer {
  private readonly pending = new Map<string, () => void>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private readonly windowMs: number) {}

  /** Запланировать отправку по ключу; в пределах окна отправится только последняя. */
  schedule(key: string, send: () => void): void {
    this.pending.set(key, send)
    if (this.timers.has(key)) return
    const timer = setTimeout(() => {
      this.timers.delete(key)
      const last = this.pending.get(key)
      this.pending.delete(key)
      last?.()
    }, this.windowMs)
    // Таймер склейки не должен держать процесс живым при остановке.
    timer.unref?.()
    this.timers.set(key, timer)
  }

  /** Сбросить все отложенные отправки (остановка модуля). */
  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.pending.clear()
  }
}
