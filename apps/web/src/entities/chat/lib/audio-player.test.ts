import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  closeAudio,
  getAudioElement,
  playAudioTrack,
  playNeighbour,
  setAudioQueue,
  type AudioTrack,
} from './audio-player'
import {
  getAudioSettings,
  setAudioVolume,
  toggleAudioMuted,
  toggleAudioRepeat,
  toggleAudioShuffle,
} from './audio-settings'

// Состояние плеера модульное; какой трек заиграл, видно по тому, чью ссылку плеер спросил у
// очереди, а громкость и повтор — по самому элементу звука.
const song = (id: string): AudioTrack => ({ id, voice: false, title: id, queueKey: 'music' })
const voice = (id: string): AudioTrack => ({ id, voice: true, title: id, queueKey: 'voice' })

let resolved: string[] = []
const resolve = (id: string): Promise<string> => {
  resolved.push(id)
  return Promise.resolve(`blob:${id}`)
}

function current(): string | null {
  return resolved[resolved.length - 1] ?? null
}

function resetSettings(): void {
  const s = getAudioSettings()
  if (s.shuffle) toggleAudioShuffle()
  if (s.repeat !== 'none') toggleAudioRepeat(s.repeat)
  if (s.muted) toggleAudioMuted()
  setAudioVolume(1)
}

beforeAll(() => {
  // В jsdom у медиа-элементов нет воспроизведения.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
})

afterEach(() => {
  closeAudio()
  resetSettings()
  resolved = []
})

describe('общий аудиоплеер: режимы музыки', () => {
  it('«повторять все» после последней песни идёт к первой', () => {
    setAudioQueue('music', [song('a'), song('b'), song('c')], resolve)
    toggleAudioRepeat('all')
    playAudioTrack(song('c'))
    playNeighbour(1, true)
    expect(current()).toBe('a')
  })

  it('без повтора конец списка закрывает плеер', () => {
    setAudioQueue('music', [song('a'), song('b')], resolve)
    playAudioTrack(song('b'))
    playNeighbour(1, true)
    expect(resolved).toEqual(['b'])
    expect(getAudioElement()?.getAttribute('src')).toBeNull()
  })

  it('«повторять трек» зацикливает сам элемент', () => {
    setAudioQueue('music', [song('a')], resolve)
    toggleAudioRepeat('one')
    playAudioTrack({ ...song('a'), url: 'blob:a' })
    expect(getAudioElement()?.loop).toBe(true)
  })

  it('перемешивание проходит все песни по разу и ◀ возвращает к прежней', () => {
    setAudioQueue('music', [song('a'), song('b'), song('c'), song('d')], resolve)
    toggleAudioShuffle()
    playAudioTrack(song('a'))
    playNeighbour(1, true)
    playNeighbour(1, true)
    playNeighbour(1, true)
    expect(new Set(resolved)).toEqual(new Set(['a', 'b', 'c', 'd']))
    const third = resolved[2]
    playNeighbour(-1)
    expect(current()).toBe(third)
  })

  it('громкость и повтор — только у музыки, голосовое на полной громкости', () => {
    setAudioVolume(0.3)
    toggleAudioRepeat('one')
    setAudioQueue('music', [song('a')], resolve)
    setAudioQueue('voice', [voice('v1'), voice('v2')], resolve)

    playAudioTrack({ ...song('a'), url: 'blob:a' })
    expect(getAudioElement()?.volume).toBeCloseTo(0.3)

    playAudioTrack({ ...voice('v1'), url: 'blob:v1' })
    expect(getAudioElement()?.volume).toBe(1)
    expect(getAudioElement()?.loop).toBe(false)
  })

  it('у голосовых повтор не действует: после последнего плеер закрывается', () => {
    toggleAudioRepeat('all')
    setAudioQueue('voice', [voice('v1'), voice('v2')], resolve)
    playAudioTrack(voice('v2'))
    playNeighbour(1, true)
    expect(resolved).toEqual(['v2'])
  })

  it('трек из панели играет по её очереди, а не по истории чата', () => {
    // В истории чата за «a» идёт «y», в списке панели — «x».
    const inChat = (id: string): AudioTrack => ({
      ...song(id),
      queueKey: undefined,
      chatId: 'chat-1',
    })
    setAudioQueue('chat-1', [inChat('a'), inChat('y')], resolve)
    setAudioQueue(
      'panel',
      [
        { ...song('a'), chatId: 'chat-1', queueKey: 'panel' },
        { ...song('x'), chatId: 'chat-1', queueKey: 'panel' },
      ],
      resolve,
    )
    playAudioTrack({ ...song('a'), chatId: 'chat-1', queueKey: 'panel' })
    playNeighbour(1, true)
    expect(resolved).toEqual(['a', 'x'])
  })
})
