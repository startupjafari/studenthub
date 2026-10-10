'use client'

import { useEffect, useState } from 'react'

/** Огибающая голосового: громкость по времени и точная длительность. */
export interface VoiceProfile {
  /** Громкость по времени, 0..1, нормированная по самому громкому месту записи. */
  envelope: number[]
  /** Длительность в секундах — из декодированного звука, а не из метаданных контейнера. */
  duration: number
}

/**
 * Сколько отсчётов громкости снимаем с записи. Считаем один раз с запасом, а под нужное
 * число полос пересчитываем уже из них: число полос зависит от длительности и от ширины
 * пузыря, а декодировать звук заново на каждое изменение ширины было бы безумием.
 */
const RESOLUTION = 128

/** Полоса не исчезает совсем даже в тишине: волна с провалами до нуля читается как обрыв. */
export const BAR_FLOOR = 0.12

/** Волна самого короткого голосового и самого длинного — в полосах. */
const MIN_BARS = 22
const MAX_BARS = 44
/** На сколько полос волна вырастает за секунду записи: потолка достигает примерно к 20 с. */
const BARS_PER_SECOND = 1.1
/** Длительность ещё не известна — берём середину: так ширина меньше всего прыгнет потом. */
const BARS_UNKNOWN = 32

/**
 * Ширина волны по длительности, как в Telegram: секундное голосовое узкое, минутное —
 * во всю ширину пузыря. Рост не бесконечный — иначе десятиминутная запись вылезла бы за
 * экран, а разницы между пятью и десятью минутами на глаз всё равно нет.
 */
export function voiceBarCount(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return BARS_UNKNOWN
  return Math.round(Math.min(MAX_BARS, MIN_BARS + duration * BARS_PER_SECOND))
}

/**
 * Громкость по времени: RMS по равным отрезкам записи. Именно RMS, а не пиковое значение, —
 * это и есть громкость на слух, а одиночный щелчок микрофоном не поднимает отрезок целиком.
 */
export function envelopeOf(samples: Float32Array, resolution = RESOLUTION): number[] {
  const out = new Array<number>(resolution).fill(0)
  if (samples.length === 0) return out
  for (let i = 0; i < resolution; i++) {
    const from = Math.floor((i * samples.length) / resolution)
    const to = Math.min(samples.length, Math.max(from + 1, ((i + 1) * samples.length) / resolution))
    let sum = 0
    let n = 0
    for (let j = from; j < to; j++) {
      const v = samples[j] ?? 0
      sum += v * v
      n += 1
    }
    out[i] = n > 0 ? Math.sqrt(sum / n) : 0
  }
  return out
}

/**
 * Приводим к 0..1. Опорой берём верхний перцентиль, а не максимум: один стук по столу
 * иначе становится единицей, и вся речь после него прижимается к полу.
 *
 * Запись тише порога — это тишина (микрофон не услышал ничего): рисуем ровную нить, а не
 * усиленный до потолка шум, который выглядел бы как разговор.
 */
export function normalizeEnvelope(envelope: number[]): number[] {
  const sorted = [...envelope].sort((a, b) => a - b)
  const loud = sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0
  if (loud < 1e-4) return envelope.map(() => BAR_FLOOR)
  return envelope.map((v) => Math.min(1, Math.max(BAR_FLOOR, v / loud)))
}

/**
 * Пересчёт огибающей под нужное число полос. Полос всегда меньше отсчётов, поэтому берём
 * по отрезку максимум: усреднение сглаживало бы паузы между словами, а именно по ним волна
 * и читается как речь.
 */
export function resampleEnvelope(envelope: number[], count: number): number[] {
  if (count <= 0 || envelope.length === 0) return []
  const out = new Array<number>(count).fill(BAR_FLOOR)
  for (let i = 0; i < count; i++) {
    const from = Math.floor((i * envelope.length) / count)
    const to = Math.min(envelope.length, Math.max(from + 1, ((i + 1) * envelope.length) / count))
    let peak = 0
    for (let j = from; j < to; j++) peak = Math.max(peak, envelope[j] ?? 0)
    out[i] = Math.max(BAR_FLOOR, peak)
  }
  return out
}

/**
 * Потолок на декодирование. `isVoice` относит к голосовым и всякий `video/webm`, а это
 * может быть настоящий ролик на десятки мегабайт: качать и раскладывать его в память
 * ради сорока полосок нельзя. Для голосового порога с запасом — opus весит около 20 КБ/с.
 */
const MAX_DECODE_BYTES = 12 * 1024 * 1024

// Разобранные записи держим в памяти вкладки: лента виртуализована, и прокрутка туда-обратно
// иначе качала и декодировала бы одно и то же голосовое снова и снова. `null` — «пробовали,
// не вышло»: повторять нечего, волна останется запасной.
const parsed = new Map<string, VoiceProfile | null>()
const inFlight = new Map<string, Promise<VoiceProfile | null>>()

// Контекст на вкладку один: каждый новый занимает аудиовыход ОС, а их на вкладку конечное
// число — по контексту на голосовое в переписке браузер просто перестал бы их выдавать.
// Offline, а не обычный: он ничего не играет, поэтому не упирается в запрет автозапуска.
let decoder: BaseAudioContext | null = null
function decodeContext(): BaseAudioContext | null {
  if (decoder) return decoder
  const Offline =
    typeof window === 'undefined'
      ? undefined
      : (window.OfflineAudioContext ??
        (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
          .webkitOfflineAudioContext)
  if (!Offline) return null
  decoder = new Offline(1, 1, 44100)
  return decoder
}

// Старая Safari промис из decodeAudioData не возвращает вовсе — зовём колбэчную форму и
// подхватываем промис, если он всё-таки есть. Повторный resolve промис игнорирует сам.
function decodeAudio(ctx: BaseAudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    const maybe = ctx.decodeAudioData(bytes, resolve, reject) as unknown
    if (maybe && typeof (maybe as Promise<AudioBuffer>).then === 'function') {
      void (maybe as Promise<AudioBuffer>).then(resolve, reject)
    }
  })
}

async function readProfile(url: string, size: number): Promise<VoiceProfile | null> {
  if (size > MAX_DECODE_BYTES) return null
  const ctx = decodeContext()
  if (!ctx) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buffer = await decodeAudio(ctx, await res.arrayBuffer())
    if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) return null
    return {
      envelope: normalizeEnvelope(envelopeOf(buffer.getChannelData(0))),
      duration: buffer.duration,
    }
  } catch {
    // Ни сеть, ни незнакомый кодек не должны ронять переписку: без огибающей голосовое
    // по-прежнему играется, просто волна у него запасная.
    return null
  }
}

/**
 * Огибающая голосового по самой записи: полосы показывают настоящую громкость, а не узор
 * по идентификатору файла. Побочно даёт точную длительность — контейнер от MediaRecorder
 * её обычно не несёт, и ширину волны взять больше неоткуда.
 *
 * Цена — скачивание файла целиком, поэтому результат кэшируется на вкладку, а крупные
 * вложения не разбираются вовсе. Не получилось — `null`, и рисуется запасная волна.
 */
export function useVoiceProfile(
  url: string | undefined,
  id: string,
  size: number,
): VoiceProfile | null {
  const [profile, setProfile] = useState<VoiceProfile | null>(() => parsed.get(id) ?? null)

  useEffect(() => {
    if (!url) return
    const known = parsed.get(id)
    if (known !== undefined) {
      setProfile(known)
      return
    }
    let alive = true
    const pending =
      inFlight.get(id) ??
      readProfile(url, size).then((p) => {
        parsed.set(id, p)
        inFlight.delete(id)
        return p
      })
    inFlight.set(id, pending)
    void pending.then((p) => {
      if (alive) setProfile(p)
    })
    return () => {
      alive = false
    }
  }, [id, url, size])

  return profile
}
