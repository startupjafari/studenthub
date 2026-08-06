'use client'

import { useEffect, useRef, useState, type MutableRefObject } from 'react'

export interface VoiceRecorderController {
  recording: boolean
  paused: boolean
  seconds: number
  /** AnalyserNode активной записи — для визуализации волн (VoiceWaveform). */
  analyserRef: MutableRefObject<AnalyserNode | null>
  start: () => Promise<void>
  pause: () => void
  resume: () => void
  /** Остановить и отдать webm-файл наверх (onRecorded). */
  finish: () => void
  /** Остановить и отменить (файл не отдаётся). */
  cancel: () => void
}

// Запись голосового сообщения через MediaRecorder + WebAudio AnalyserNode (Ф9+, без внешних зависимостей).
// Поддерживает паузу/возобновление и отдаёт уровень громкости для анимации волн.
export function useVoiceRecorder(opts: {
  onRecorded: (file: File) => void
  onError?: (kind: 'unsupported' | 'denied') => void
}): VoiceRecorderController {
  const [recording, setRecording] = useState(false)
  const [paused, setPaused] = useState(false)
  const [seconds, setSeconds] = useState(0)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const cancelledRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onRecordedRef = useRef(opts.onRecorded)
  onRecordedRef.current = opts.onRecorded

  const stopTimer = (): void => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }
  const startTimer = (): void => {
    stopTimer()
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
  }

  const teardown = (): void => {
    stopTimer()
    streamRef.current?.getTracks().forEach((tr) => tr.stop())
    streamRef.current = null
    void audioCtxRef.current?.close().catch(() => undefined)
    audioCtxRef.current = null
    analyserRef.current = null
    recorderRef.current = null
  }

  useEffect(() => () => teardown(), [])

  async function start(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      opts.onError?.('unsupported')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser) // не подключаем к destination — избегаем эха
      audioCtxRef.current = ctx
      analyserRef.current = analyser

      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      cancelledRef.current = false
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        const cancelled = cancelledRef.current
        teardown()
        setRecording(false)
        setPaused(false)
        if (!cancelled && blob.size > 0) {
          const ext = blob.type.includes('ogg') ? 'ogg' : 'webm'
          onRecordedRef.current(
            new File([blob], `voice-${ext === 'ogg' ? 'msg.ogg' : 'msg.webm'}`, {
              type: blob.type,
            }),
          )
        }
      }
      recorder.start()
      recorderRef.current = recorder
      setSeconds(0)
      setPaused(false)
      setRecording(true)
      startTimer()
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

  return { recording, paused, seconds, analyserRef, start, pause, resume, finish, cancel }
}
