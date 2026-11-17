'use client'

import { useSyncExternalStore } from 'react'
import { getVoiceRate, subscribeVoiceRate } from './voice-rate'
import type { MessageAttachment } from '../model/types'

// Общий аудиоплеер чатов (как в Telegram): один звук на всё приложение, панель под шапкой
// чата, голосовые и музыка подряд.
//
// Играет ОДИН элемент <audio>, созданный здесь, а не тот, что в пузыре. Пузырь голосового
// живёт в виртуализированной ленте: прокрутили его за край — компонент размонтирован, и
// звук обрывался посреди фразы. Здесь он доигрывает, панель под шапкой показывает, что
// играет, а следующее голосовое того же чата начинается само.
//
// Очередь — по чатам: шапка открытого чата отдаёт сюда голосовые и музыку из загруженной
// истории (`setAudioQueue`). Ссылку на файл очередь просит только для того трека, который
// реально начнёт играть: подписанные ссылки живут недолго, подписывать всё заранее незачем.

export interface AudioTrack {
  /** id вложения: ключ трека и его голосового в ленте. */
  id: string
  chatId?: string | null
  messageId?: string | null
  /** Запись с микрофона (а не файл музыки): у музыки заголовок — название файла. */
  voice: boolean
  /** Голосовое — имя автора; музыка — название файла. */
  title: string
  /** Кто прислал музыку — вторая строка панели. */
  performer?: string | null
  createdAt?: string | null
  /** Готовая ссылка (пузырь уже знает её); нет — спросим у очереди. */
  url?: string
  /** Длительность из разбора записи или с сервера — пока элемент её не досчитал. */
  duration?: number
  /** Перейти к сообщению, если очередь не знает, где оно (обсуждение события, поддержка). */
  onGoTo?: () => void
}

export interface AudioPlayerState {
  track: AudioTrack | null
  playing: boolean
  /** Ссылка ещё едет или звук буферизуется. */
  loading: boolean
  duration: number
  /** Есть ли соседний трек того же вида в очереди — для кнопок ◀ ▶. */
  hasPrev: boolean
  hasNext: boolean
}

interface Queue {
  tracks: AudioTrack[]
  resolve: (id: string) => Promise<string>
}

/** Сколько очередей чатов держим: недавно открытые, остальные забываются. */
const MAX_QUEUES = 8
/**
 * Сколько ждать, прежде чем остановить звук, который никто не показывает (ни панель, ни
 * пузырь). Смена экрана — это размонтирование и монтирование в соседних кадрах: без паузы
 * звук обрывался бы на каждом переходе внутри чатов.
 */
const ORPHAN_STOP_MS = 400

const EMPTY: AudioPlayerState = {
  track: null,
  playing: false,
  loading: false,
  duration: 0,
  hasPrev: false,
  hasNext: false,
}

let state: AudioPlayerState = EMPTY
const listeners = new Set<() => void>()
const queues = new Map<string, Queue>()

let audio: HTMLAudioElement | null = null
/** Идёт досчёт длительности webm (прыжок в конец и обратно) — события «конец/пауза» не наши. */
let forcing = false
/** Хотели ли играть, когда начался досчёт: после возврата в начало — продолжить. */
let resumeAfterForce = false
/** С какой доли начать, когда длительность станет известна (нажали посреди волны). */
let pendingRatio: number | null = null
let holders = 0
let orphanTimer: ReturnType<typeof setTimeout> | null = null

function emit(next: Partial<AudioPlayerState>): void {
  state = { ...state, ...next, ...neighbours(next.track === undefined ? state.track : next.track) }
  for (const fn of listeners) fn()
}

/** Очередь, в которой лежит трек: его чат, а если чат неизвестен — любая, где он есть. */
function queueOf(track: AudioTrack | null): Queue | null {
  if (!track) return null
  const own = track.chatId ? queues.get(track.chatId) : undefined
  if (own?.tracks.some((t) => t.id === track.id)) return own
  for (const q of queues.values()) if (q.tracks.some((t) => t.id === track.id)) return q
  return null
}

/** Соседи того же вида: после голосового — следующее голосовое, после песни — песня. */
function sameKind(track: AudioTrack): AudioTrack[] {
  return queueOf(track)?.tracks.filter((t) => t.voice === track.voice) ?? []
}

function neighbours(track: AudioTrack | null): Pick<AudioPlayerState, 'hasPrev' | 'hasNext'> {
  if (!track) return { hasPrev: false, hasNext: false }
  const list = sameKind(track)
  const i = list.findIndex((t) => t.id === track.id)
  return { hasPrev: i > 0, hasNext: i >= 0 && i < list.length - 1 }
}

function knownDuration(a: HTMLAudioElement): number | null {
  return Number.isFinite(a.duration) && a.duration > 0 ? a.duration : null
}

function applyPending(a: HTMLAudioElement, duration: number): void {
  if (pendingRatio === null) return
  const ratio = pendingRatio
  pendingRatio = null
  try {
    a.currentTime = ratio * duration
  } catch {
    // Перемотка не удалась (поток ещё не готов) — играем с начала.
  }
}

function element(): HTMLAudioElement {
  if (audio) return audio
  const a = new Audio()
  a.preload = 'auto'
  a.addEventListener('play', () => {
    // Скорость — общая запомненная (lib/voice-rate): смена src её сбрасывает.
    a.playbackRate = getVoiceRate()
    if (!forcing) emit({ playing: true })
  })
  a.addEventListener('playing', () => emit({ loading: false }))
  a.addEventListener('waiting', () => emit({ loading: true }))
  a.addEventListener('pause', () => {
    if (!forcing) emit({ playing: false })
  })
  a.addEventListener('ended', () => {
    if (forcing) return
    playNeighbour(1, true)
  })
  a.addEventListener('error', () => {
    forcing = false
    emit({ playing: false, loading: false })
  })
  a.addEventListener('loadedmetadata', () => {
    const d = knownDuration(a)
    if (d) {
      emit({ duration: d })
      applyPending(a, d)
      return
    }
    // webm/opus от MediaRecorder часто без длительности (Infinity): без неё браузер не
    // умеет ни перематывать, ни показывать прогресс. Прыжок «в конец» заставляет его
    // досчитать длительность (durationchange), затем возвращаемся в начало.
    forcing = true
    resumeAfterForce = !a.paused
    try {
      a.currentTime = 1e101
    } catch {
      forcing = false
    }
  })
  a.addEventListener('durationchange', () => {
    const d = knownDuration(a)
    if (!d) return
    emit({ duration: d })
    if (!forcing) return
    forcing = false
    try {
      a.currentTime = 0
    } catch {
      // Вернуть указатель не дали — играем оттуда, где он есть.
    }
    applyPending(a, d)
    if (resumeAfterForce) void a.play().catch(() => emit({ playing: false }))
  })
  subscribeVoiceRate(() => {
    a.playbackRate = getVoiceRate()
  })
  audio = a
  return a
}

/** Элемент, который сейчас звучит: пузыри и панель читают из него время на каждом кадре. */
export function getAudioElement(): HTMLAudioElement | null {
  return audio
}

/**
 * Начать трек (или продолжить, если он уже текущий). `startRatio` — откуда: нажали посреди
 * волны голосового, которое ещё не играло.
 *
 * `play()` зовётся синхронно, пока идёт нажатие, если ссылка уже есть: iOS разрешает звук
 * только из жеста, и первый запуск из колбэка промиса там молча не сработал бы.
 */
export function playAudioTrack(track: AudioTrack, startRatio?: number): void {
  const a = element()
  const known = queueOf(track)?.tracks.find((t) => t.id === track.id)
  const merged: AudioTrack = { ...(known ?? track), ...stripUndefined(track) }
  if (state.track?.id === merged.id && a.src) {
    if (startRatio !== undefined) seekAudioRatio(startRatio)
    void a.play().catch(() => emit({ playing: false }))
    return
  }
  forcing = false
  pendingRatio = startRatio ?? null
  emit({ track: merged, playing: false, loading: true, duration: merged.duration ?? 0 })
  const start = (url: string): void => {
    if (state.track?.id !== merged.id) return
    a.src = url
    a.defaultPlaybackRate = getVoiceRate()
    a.playbackRate = getVoiceRate()
    void a.play().catch(() => emit({ playing: false, loading: false }))
  }
  if (merged.url) {
    start(merged.url)
    return
  }
  const queue = queueOf(merged)
  if (!queue) {
    emit({ loading: false })
    return
  }
  queue.resolve(merged.id).then(start, () => {
    if (state.track?.id === merged.id) emit({ playing: false, loading: false })
  })
}

function stripUndefined(track: AudioTrack): Partial<AudioTrack> {
  const out: Partial<AudioTrack> = {}
  for (const [k, v] of Object.entries(track) as [keyof AudioTrack, unknown][]) {
    if (v !== undefined && v !== null && v !== '') (out as Record<string, unknown>)[k] = v
  }
  return out
}

export function toggleAudio(): void {
  const a = audio
  if (!a || !state.track) return
  if (a.paused) void a.play().catch(() => emit({ playing: false }))
  else a.pause()
}

/** Перемотать текущий трек на долю длительности. */
export function seekAudioRatio(ratio: number): void {
  const a = audio
  if (!a) return
  const d = knownDuration(a) ?? state.duration
  if (!d) {
    pendingRatio = ratio
    return
  }
  try {
    a.currentTime = Math.min(1, Math.max(0, ratio)) * d
  } catch {
    // Поток не готов к перемотке — оставляем как есть.
  }
}

/** Сдвинуть на `delta` секунд (стрелки клавиатуры на полосе панели). */
export function nudgeAudio(delta: number): void {
  const a = audio
  if (!a) return
  const d = knownDuration(a) ?? state.duration
  if (!d) return
  a.currentTime = Math.min(d, Math.max(0, a.currentTime + delta))
}

/**
 * Соседний трек того же вида. `auto` — закончился предыдущий: в конце очереди панель
 * закрывается (как в Telegram), а ручное «следующее» на последнем просто ничего не делает.
 */
export function playNeighbour(direction: 1 | -1, auto = false): void {
  const track = state.track
  if (!track) return
  const list = sameKind(track)
  const i = list.findIndex((t) => t.id === track.id)
  const next = i >= 0 ? list[i + direction] : undefined
  if (next) {
    playAudioTrack(next)
    return
  }
  if (auto) closeAudio()
}

/** Остановить и убрать панель. */
export function closeAudio(): void {
  forcing = false
  pendingRatio = null
  if (audio) {
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
  emit({ ...EMPTY })
}

/** Отдать плееру голосовые и музыку чата — для «следующего» и кнопок панели. */
export function setAudioQueue(
  chatId: string,
  tracks: AudioTrack[],
  resolve: (id: string) => Promise<string>,
): void {
  queues.delete(chatId)
  queues.set(chatId, { tracks, resolve })
  // Самые давние чаты забываем — кроме того, где играет текущий трек.
  for (const id of queues.keys()) {
    if (queues.size <= MAX_QUEUES) break
    if (id !== state.track?.chatId) queues.delete(id)
  }
  if (state.track) emit({})
}

/**
 * «Звук кому-то показан»: панель или пузырь текущего трека на экране. Когда не осталось
 * никого (ушли из чатов), звук останавливается — иначе он играл бы без единой кнопки «стоп».
 */
export function retainAudioPlayer(): () => void {
  holders += 1
  if (orphanTimer) {
    clearTimeout(orphanTimer)
    orphanTimer = null
  }
  let released = false
  return () => {
    if (released) return
    released = true
    holders -= 1
    if (holders > 0) return
    orphanTimer = setTimeout(() => {
      orphanTimer = null
      if (holders <= 0 && state.track) closeAudio()
    }, ORPHAN_STOP_MS)
  }
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

const getState = (): AudioPlayerState => state
const getServerState = (): AudioPlayerState => EMPTY

export function useAudioPlayer(): AudioPlayerState {
  return useSyncExternalStore(subscribe, getState, getServerState)
}

/**
 * Голосовое ли это (запись с микрофона), а не музыка. Встроенный рекордер называет файл
 * `voice-…`; у старых вложений без имени звук считаем голосовым — музыку присылают файлом
 * с названием.
 */
export function isVoiceRecording(att: Pick<MessageAttachment, 'name'>): boolean {
  return !att.name || /^voice-/i.test(att.name)
}
