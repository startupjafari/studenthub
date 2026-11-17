'use client'

import { useEffect, useRef, useState } from 'react'
import type { VoiceRecorderController } from './use-voice-recorder'

/** Потолок длины кружка, как в Telegram: дальше запись останавливается и уходит сама. */
export const ROUND_VIDEO_MAX_SECONDS = 60

/**
 * Запись кружка — тот же контроллер, что у голосового (удержание, замок, отмена работают
 * одинаково), плюс живой поток камеры для круглого превью во время записи.
 */
export interface RoundVideoRecorderController extends VoiceRecorderController {
  /** Поток камеры и микрофона, пока идёт запись. Превью рисует его в `<video srcObject>`. */
  stream: MediaStream | null
}

// Формат записи видео. Chrome/Firefox/Android → webm (vp9/vp8 + opus), Safari → mp4 (h264 +
// aac). Расширение нужно имени файла; тип по содержимому определит сервер.
function pickVideoFormat(): { mimeType?: string; ext: string } {
  const candidates: { mimeType: string; ext: string }[] = [
    { mimeType: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { mimeType: 'video/webm;codecs=vp8,opus', ext: 'webm' },
    { mimeType: 'video/webm', ext: 'webm' },
    { mimeType: 'video/mp4;codecs=avc1,mp4a', ext: 'mp4' },
    { mimeType: 'video/mp4', ext: 'mp4' },
  ]
  if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function') {
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c.mimeType)) return c
    }
  }
  return { ext: 'webm' }
}

/**
 * Запись кружка с фронтальной камеры (MediaRecorder, без внешних зависимостей).
 *
 * Кадр просим квадратным и небольшим (480×480): кружок показывается диаметром в 240 px, и
 * больше пикселей не дали бы ничего, кроме веса файла. Камера может отдать и 4:3 — круг всё
 * равно кадрирует по центру (`object-cover`), поэтому перекодировать на клиенте не нужно.
 *
 * Уровень звука идёт в тот же AnalyserNode, что у голосового: строка записи в поле ввода
 * общая и рисует волну по нему.
 */
export function useRoundVideoRecorder(opts: {
  onRecorded: (file: File) => void
  onStart?: () => void
  onStop?: () => void
  onError?: (kind: 'unsupported' | 'denied') => void
}): RoundVideoRecorderController {
  const [recording, setRecording] = useState(false)
  const [paused, setPaused] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [stream, setStream] = useState<MediaStream | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const formatRef = useRef<{ mimeType?: string; ext: string }>({ ext: 'webm' })
  const cancelledRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const secondsRef = useRef(0)
  // Колбэки — через ref: `recorder.onstop` замыкается на момент старта записи.
  const onRecordedRef = useRef(opts.onRecorded)
  onRecordedRef.current = opts.onRecorded
  const onStopRef = useRef(opts.onStop)
  onStopRef.current = opts.onStop

  const stopTimer = (): void => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }
  const startTimer = (): void => {
    stopTimer()
    timerRef.current = setInterval(() => {
      secondsRef.current += 1
      setSeconds(secondsRef.current)
      // Потолок длины: дописанное уходит само, как в Telegram.
      if (secondsRef.current >= ROUND_VIDEO_MAX_SECONDS) {
        cancelledRef.current = false
        recorderRef.current?.stop()
      }
    }, 1000)
  }

  const teardown = (): void => {
    stopTimer()
    streamRef.current?.getTracks().forEach((tr) => tr.stop())
    streamRef.current = null
    setStream(null)
    void audioCtxRef.current?.close().catch(() => undefined)
    audioCtxRef.current = null
    analyserRef.current = null
    recorderRef.current = null
  }

  useEffect(() => () => teardown(), [])

  async function start(): Promise<void> {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      opts.onError?.('unsupported')
      return
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
          facingMode: 'user',
          width: { ideal: 480 },
          height: { ideal: 480 },
          aspectRatio: { ideal: 1 },
        },
      })
      streamRef.current = media
      setStream(media)

      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      // Не подключаем к destination — иначе человек слышит себя с задержкой.
      ctx.createMediaStreamSource(media).connect(analyser)
      audioCtxRef.current = ctx
      analyserRef.current = analyser

      const format = pickVideoFormat()
      formatRef.current = format
      const recorder = format.mimeType
        ? new MediaRecorder(media, { mimeType: format.mimeType, videoBitsPerSecond: 1_000_000 })
        : new MediaRecorder(media)
      chunksRef.current = []
      cancelledRef.current = false
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const type = recorder.mimeType || formatRef.current.mimeType || 'video/webm'
        const blob = new Blob(chunksRef.current, { type })
        const cancelled = cancelledRef.current
        teardown()
        setRecording(false)
        setPaused(false)
        onStopRef.current?.()
        if (!cancelled && blob.size > 0) {
          // Тип без параметров кодеков: их несёт содержимое, а сервер читает именно его.
          const plain = type.split(';')[0] || 'video/webm'
          onRecordedRef.current(
            new File([blob], `round-${Date.now()}.${formatRef.current.ext}`, { type: plain }),
          )
        }
      }
      recorder.start()
      recorderRef.current = recorder
      secondsRef.current = 0
      setSeconds(0)
      setPaused(false)
      setRecording(true)
      startTimer()
      opts.onStart?.()
    } catch {
      teardown()
      opts.onError?.('denied')
    }
  }

  function pause(): void {
    const r = recorderRef.current
    if (r && r.state === 'recording') {
      r.pause()
      stopTimer()
      setPaused(true)
    }
  }

  function resume(): void {
    const r = recorderRef.current
    if (r && r.state === 'paused') {
      r.resume()
      startTimer()
      setPaused(false)
    }
  }

  function finish(): void {
    cancelledRef.current = false
    recorderRef.current?.stop()
  }

  function cancel(): void {
    cancelledRef.current = true
    recorderRef.current?.stop()
  }

  return {
    recording,
    paused,
    seconds,
    analyserRef,
    stream,
    start,
    pause,
    resume,
    finish,
    cancel,
  }
}
