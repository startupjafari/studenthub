// Выбор мастер-вкладки: WS-соединение держит ровно одна вкладка, остальные работают через неё
// (docs/FRONTEND_RULES.md §8 — одно соединение на приложение; здесь — одно на все вкладки аккаунта).
// Транспорт выборов — BroadcastChannel, отдельный от шины данных (realtime-bus.ts), чтобы
// служебный трафик выборов не смешивался с событиями сервера.

// Сколько ждём отклика действующего лидера, прежде чем объявить лидером себя.
const ELECTION_TIMEOUT_MS = 150
// Период сердцебиения лидера.
const HEARTBEAT_INTERVAL_MS = 1000
// Молчание дольше этого — лидер считается мёртвым (вкладка убита без pagehide, спящий таб).
const LEADER_TIMEOUT_MS = 3000

type ElectionMessage =
  // Новая вкладка спрашивает, есть ли лидер.
  | { kind: 'hello' }
  // Заявка на лидерство; она же сердцебиение действующего лидера.
  | { kind: 'leader'; token: number }
  // Лидер уходит (закрытие вкладки, логаут) — мгновенный failover без ожидания таймаута.
  | { kind: 'resign' }

export interface LeaderElection {
  isLeader: () => boolean
  /** Подписка на смену роли. Вызывается сразу с текущим значением. Возвращает отписку. */
  onChange: (callback: (isLeader: boolean) => void) => () => void
  destroy: () => void
}

/**
 * `key` разделяет выборы между аккаунтами: вкладки разных пользователей не должны делить
 * соединение. Нет BroadcastChannel (старый Safari) — каждая вкладка сама себе лидер,
 * то есть прежнее поведение «сокет в каждой вкладке».
 */
export function createLeaderElection(key: string): LeaderElection {
  const callbacks = new Set<(isLeader: boolean) => void>()
  let leader = false

  const notify = (): void => {
    callbacks.forEach((cb) => cb(leader))
  }

  if (typeof BroadcastChannel === 'undefined') {
    leader = true
    return {
      isLeader: () => true,
      onChange: (callback) => {
        callback(true)
        callbacks.add(callback)
        return () => callbacks.delete(callback)
      },
      destroy: () => callbacks.clear(),
    }
  }

  const channel = new BroadcastChannel(`studenthub-leader:${key}`)
  // Токен разрешает одновременные заявки: выигрывает меньший.
  const token = Math.random()
  let lastSeenLeaderAt = 0
  let electionTimer: ReturnType<typeof setTimeout> | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let destroyed = false

  const post = (message: ElectionMessage): void => {
    if (!destroyed) channel.postMessage(message)
  }

  const stopHeartbeat = (): void => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  const becomeLeader = (): void => {
    if (destroyed || leader) return
    leader = true
    post({ kind: 'leader', token })
    heartbeatTimer = setInterval(() => post({ kind: 'leader', token }), HEARTBEAT_INTERVAL_MS)
    notify()
  }

  const stepDown = (): void => {
    if (!leader) return
    leader = false
    stopHeartbeat()
    notify()
  }

  const startElection = (): void => {
    if (destroyed || leader || electionTimer) return
    // Таймер ставим ДО hello: ответ действующего лидера может прийти синхронно, и к этому
    // моменту отменять уже должно быть что.
    electionTimer = setTimeout(() => {
      electionTimer = null
      becomeLeader()
    }, ELECTION_TIMEOUT_MS)
    post({ kind: 'hello' })
  }

  const cancelElection = (): void => {
    if (electionTimer) {
      clearTimeout(electionTimer)
      electionTimer = null
    }
  }

  channel.onmessage = ({ data }: MessageEvent<ElectionMessage>) => {
    if (destroyed || !data) return

    if (data.kind === 'hello') {
      // Подтверждаем новичку, что лидер уже есть.
      if (leader) post({ kind: 'leader', token })
      return
    }

    if (data.kind === 'leader') {
      lastSeenLeaderAt = Date.now()
      // Двоевластие после одновременной заявки: уступает больший токен.
      if (leader && data.token < token) {
        stepDown()
        return
      }
      if (!leader) cancelElection()
      return
    }

    // resign: лидер ушёл — перевыборы немедленно.
    if (!leader) {
      lastSeenLeaderAt = 0
      startElection()
    }
  }

  // Сторож: лидер мог умереть без resign (краш, kill вкладки, iOS выгрузил из памяти).
  const watchdog = setInterval(() => {
    if (destroyed || leader || electionTimer) return
    if (Date.now() - lastSeenLeaderAt > LEADER_TIMEOUT_MS) startElection()
  }, HEARTBEAT_INTERVAL_MS)

  // pagehide, а не beforeunload: последний не срабатывает при выгрузке вкладки на мобильных.
  // Сначала слагаем полномочия, потом объявляем об уходе: иначе на `hello` от перехватывающей
  // вкладки мы ответим «лидер жив» и сорвём ей выборы. Порядок важен и в destroy ниже.
  // Страница может вернуться из bfcache — тогда роль восстановит сторож.
  const onPageHide = (): void => {
    if (!leader) return
    stepDown()
    post({ kind: 'resign' })
  }
  window.addEventListener('pagehide', onPageHide)

  startElection()

  return {
    isLeader: () => leader,
    onChange: (callback) => {
      callback(leader)
      callbacks.add(callback)
      return () => callbacks.delete(callback)
    },
    destroy: () => {
      if (destroyed) return
      const wasLeader = leader
      leader = false
      stopHeartbeat()
      if (wasLeader) post({ kind: 'resign' })
      destroyed = true
      cancelElection()
      clearInterval(watchdog)
      window.removeEventListener('pagehide', onPageHide)
      channel.onmessage = null
      channel.close()
      callbacks.clear()
    },
  }
}
