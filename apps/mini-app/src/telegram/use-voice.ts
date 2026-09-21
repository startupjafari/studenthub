import { useCallback, useRef, useState } from 'react'

// Запись голосового ответа в мини-аппе.
//
// Та же механика, что в вебе (MediaRecorder без библиотек), но урезанная до одного жеста:
// нажал — говоришь, нажал ещё раз — ушло. Паузы, волны и отмена свайпом на экране, где
// помещается три кнопки, только мешали бы.
//
// Формат подбираем по поддержке браузера: Chrome и Android умеют webm/opus, iOS — mp4/aac.
// Имя файла всегда `voice-msg.<ext>` — по нему чат распознаёт голосовое, потому что mime
// по содержимому непредсказуем (webm-аудио приезжает как `video/webm`).
function pickFormat(): { mimeType?: string; ext: string } {
  const candidates = [
    { mimeType: 'audio/webm;codecs=opus', ext: 'webm' },
    { mimeType: 'audio/webm', ext: 'webm' },
    { mimeType: 'audio/ogg;codecs=opus', ext: 'ogg' },
    { mimeType: 'audio/mp4', ext: 'm4a' },
  ]
  if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function') {
    for (const candidate of candidates) {
      if (MediaRecorder.isTypeSupported(candidate.mimeType)) return candidate
    }
  }
  return { ext: 'webm' }
}

export interface VoiceRecorder {
  recording: boolean
  /** Секунды записи — единственная обратная связь, которая на этом экране помещается. */
  seconds: number
  supported: boolean
  start: () => Promise<void>
  stop: () => void
  cancel: () => void
}

export function useVoiceRecorder(onRecorded: (file: File) => void): VoiceRecorder {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const cancelledRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const supported =
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator?.mediaDevices?.getUserMedia === 'function'

  const release = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    recorderRef.current = null
    setRecording(false)
    setSeconds(0)
  }, [])

  const start = useCallback(async () => {
    if (!supported || recorderRef.current) return
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const format = pickFormat()
    const recorder = new MediaRecorder(stream, format.mimeType ? { mimeType: format.mimeType } : {})
    chunksRef.current = []
    cancelledRef.current = false

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
      // Отменённую запись не отдаём наверх: отмена должна означать «этого не было»,
      // а не «отправилось, но мы не показали».
      if (!cancelledRef.current && blob.size > 0) {
        onRecorded(new File([blob], `voice-msg.${format.ext}`, { type: blob.type }))
      }
      release()
    }

    recorderRef.current = recorder
    streamRef.current = stream
    recorder.start()
    setRecording(true)
    timerRef.current = setInterval(() => setSeconds((value) => value + 1), 1000)
  }, [onRecorded, release, supported])

  const stop = useCallback(() => recorderRef.current?.stop(), [])
  const cancel = useCallback(() => {
    cancelledRef.current = true
    recorderRef.current?.stop()
  }, [])

  return { recording, seconds, supported, start, stop, cancel }
}
