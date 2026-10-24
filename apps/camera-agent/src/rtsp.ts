import type { CameraCredentials } from './sealed.js'

// Адрес потока камеры. Платформа хранит его без логина и пароля; агент подставляет их
// только в момент обращения к камере, а в журнал пишет адрес без них.

const RTSP = /^(rtsps?:\/\/)([^/?#]*)(.*)$/i

export function withCredentials(streamUrl: string, credentials: CameraCredentials | null): string {
  const match = RTSP.exec(streamUrl)
  if (!match) {
    if (!credentials) return streamUrl
    throw new Error('Адрес потока должен начинаться с rtsp://')
  }
  const [, scheme = '', authority, rest] = match
  // Схема в адресе регистронезависима, и платформа принимает `RTSP://`, а ffmpeg и ffprobe
  // ищут протокол по имени с учётом регистра и такой адрес не откроют.
  const lower = scheme.toLowerCase()
  if (!credentials) return `${lower}${authority}${rest}`
  const user = encodeURIComponent(credentials.username)
  const pass = encodeURIComponent(credentials.password)
  return `${lower}${user}:${pass}@${authority}${rest}`
}

/** Адрес для журнала: логин и пароль вырезаны, даже если кто-то вписал их в адрес. */
export function redactUrl(url: string): string {
  return url.replace(/^(rtsps?:\/\/)[^@/?#]*@/i, '$1***@')
}

/**
 * Произвольный текст для журнала (stderr ffmpeg): ffmpeg повторяет в ошибках адрес входа
 * целиком — с логином и паролем камеры, — а адрес выхода с токеном ретранслятора.
 */
export function redactText(text: string): string {
  return text.replace(/(rtsps?:\/\/)[^@/?#\s]*@/gi, '$1***@').replace(/pass=[^&\s]+/g, 'pass=***')
}
