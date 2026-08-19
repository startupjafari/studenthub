import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeBroadcastChannel } from './broadcast-channel.fake'
import { createLeaderElection } from './leader-election'

// Каждый экземпляр FakeBroadcastChannel играет роль отдельной вкладки.

const ELECTION_TIMEOUT_MS = 150
const LEADER_TIMEOUT_MS = 3000

beforeEach(() => {
  vi.useFakeTimers()
  FakeBroadcastChannel.reset()
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('createLeaderElection', () => {
  it('единственная вкладка становится лидером после окна выборов', () => {
    const tab = createLeaderElection('u1')
    expect(tab.isLeader()).toBe(false)

    vi.advanceTimersByTime(ELECTION_TIMEOUT_MS)
    expect(tab.isLeader()).toBe(true)

    tab.destroy()
  })

  it('вторая вкладка остаётся ведомой, пока жив лидер', () => {
    const first = createLeaderElection('u1')
    vi.advanceTimersByTime(ELECTION_TIMEOUT_MS)

    const second = createLeaderElection('u1')
    vi.advanceTimersByTime(ELECTION_TIMEOUT_MS)

    expect(first.isLeader()).toBe(true)
    expect(second.isLeader()).toBe(false)

    first.destroy()
    second.destroy()
  })

  it('вкладки разных аккаунтов не мешают друг другу — обе лидеры', () => {
    const alice = createLeaderElection('u1')
    const bob = createLeaderElection('u2')
    vi.advanceTimersByTime(ELECTION_TIMEOUT_MS)

    expect(alice.isLeader()).toBe(true)
    expect(bob.isLeader()).toBe(true)

    alice.destroy()
    bob.destroy()
  })

  it('уход лидера (destroy → resign) передаёт лидерство немедленно', () => {
    const first = createLeaderElection('u1')
    vi.advanceTimersByTime(ELECTION_TIMEOUT_MS)
    const second = createLeaderElection('u1')
    vi.advanceTimersByTime(ELECTION_TIMEOUT_MS)
    expect(second.isLeader()).toBe(false)

    first.destroy()
    vi.advanceTimersByTime(ELECTION_TIMEOUT_MS)

    expect(second.isLeader()).toBe(true)
    second.destroy()
  })

  it('лидер умер без resign — сторож устраивает перевыборы по таймауту', () => {
    const first = createLeaderElection('u1')
    vi.advanceTimersByTime(ELECTION_TIMEOUT_MS)
    const second = createLeaderElection('u1')
    vi.advanceTimersByTime(ELECTION_TIMEOUT_MS)
    expect(second.isLeader()).toBe(false)

    // Имитируем краш вкладки-лидера: канал глохнет в обе стороны (ни heartbeat, ни приём),
    // resign при этом не отправляется. Set хранит порядок вставки — первый элемент принадлежит
    // первой вкладке.
    const [crashed] = FakeBroadcastChannel.peers('studenthub-leader:u1')
    if (crashed) {
      crashed.close()
      crashed.postMessage = () => {}
    }

    vi.advanceTimersByTime(LEADER_TIMEOUT_MS + ELECTION_TIMEOUT_MS + 1000)
    expect(second.isLeader()).toBe(true)

    first.destroy()
    second.destroy()
  })

  it('двоевластие после одновременной заявки: уступает бо́льший токен', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    const tab = createLeaderElection('u1')
    vi.advanceTimersByTime(ELECTION_TIMEOUT_MS)
    expect(tab.isLeader()).toBe(true)

    // Другая вкладка объявила себя лидером в том же окне — её заявка успела разойтись
    // раньше, чем она услышала нашу. Меньший токен побеждает.
    const rival = new FakeBroadcastChannel('studenthub-leader:u1')
    rival.postMessage({ kind: 'leader', token: 0.1 })
    expect(tab.isLeader()).toBe(false)

    rival.close()
    tab.destroy()
  })

  it('onChange отдаёт текущую роль сразу и сообщает о смене', () => {
    const tab = createLeaderElection('u1')
    const seen: boolean[] = []
    const unsubscribe = tab.onChange((isLeader) => seen.push(isLeader))

    expect(seen).toEqual([false])
    vi.advanceTimersByTime(ELECTION_TIMEOUT_MS)
    expect(seen).toEqual([false, true])

    unsubscribe()
    tab.destroy()
  })

  it('без BroadcastChannel вкладка сразу лидер — прежнее поведение', () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    const tab = createLeaderElection('u1')
    expect(tab.isLeader()).toBe(true)
    tab.destroy()
  })
})
