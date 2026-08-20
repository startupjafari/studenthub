// Тестовый дубль BroadcastChannel: jsdom его не реализует, а поведение мастер-вкладки без него
// не проверить. Доставка синхронная (в отличие от настоящего API) — тестам так проще, а логика
// выборов от этого не зависит. Используется только из *.test.ts, в бандл приложения не попадает.

export class FakeBroadcastChannel {
  static readonly registry = new Map<string, Set<FakeBroadcastChannel>>()

  /** Сбросить все каналы между тестами. */
  static reset(): void {
    FakeBroadcastChannel.registry.clear()
  }

  /** Каналы с этим именем в порядке создания — чтобы тест мог «уронить» конкретную вкладку. */
  static peers(name: string): FakeBroadcastChannel[] {
    return [...(FakeBroadcastChannel.registry.get(name) ?? [])]
  }

  onmessage: ((event: MessageEvent) => void) | null = null

  constructor(readonly name: string) {
    const peers = FakeBroadcastChannel.registry.get(name) ?? new Set<FakeBroadcastChannel>()
    peers.add(this)
    FakeBroadcastChannel.registry.set(name, peers)
  }

  postMessage(data: unknown): void {
    const peers = FakeBroadcastChannel.registry.get(this.name)
    if (!peers) return
    // Копия набора: получатель может закрыть свой канал прямо в обработчике.
    for (const peer of [...peers]) {
      if (peer !== this) peer.onmessage?.({ data } as MessageEvent)
    }
  }

  close(): void {
    FakeBroadcastChannel.registry.get(this.name)?.delete(this)
  }
}
