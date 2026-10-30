/**
 * Что за QR StudentHub перед камерой и куда с ним идти.
 *
 * Все наши QR — это ссылки на веб: вход на другом устройстве (`/qr?t=`), студенческий
 * (`/verify-id?t=`), самоотметка на паре (`/checkin?t=`), наклейка помещения (`/r/<код>`),
 * выданный документ (`/verify/<код>`), публичное резюме (`/r/resume/<slug>`), приглашение
 * в чат (`/join-chat/<id>?k=`). Формат не меняем: наклейки на дверях и коды на справках уже
 * напечатаны, а камера телефона без приложения продолжает открывать те же ссылки.
 *
 * Домен не сверяем, сверяем путь. Ссылки в QR собираются из разных переменных
 * (`CORS_ORIGIN`, `APP_PUBLIC_URL` для документов), и на проде домен справки может не
 * совпадать с доменом, где открыт веб. Это безопасно, потому что наружу сканер не ведёт:
 * переход собирается заново из проверенных частей и всегда остаётся внутри приложения.
 * Подсунутый «свой» QR даёт не больше, чем та же ссылка на нашем домене: токен проверяет
 * сервер, а вход по QR сначала показывает, чьё устройство его просит.
 */
export type QrTargetKind =
  'login' | 'studentId' | 'checkin' | 'room' | 'bookCopy' | 'document' | 'resume' | 'chatInvite'

export interface QrTarget {
  kind: QrTargetKind
  /** Относительный путь внутри приложения. */
  href: string
  /** Токен или код из ссылки — для экранов, которые разбирают его сами. */
  value: string
}

// Токены одноразовых ссылок: UUID (вход), подписанный и зашифрованный payload (отметка,
// студенческий). Потолок длины — от мусора, а не от настоящих токенов.
const MAX_TOKEN_LENGTH = 2048

// Алфавит человекочитаемых кодов бэкенда (common/crypto/readable-code.ts): без 0/O, 1/I/L.
const ROOM_CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/
const SLUG = /^[A-Za-z0-9_-]{1,128}$/

// Ссылки с токеном в `?t=`: путь → вид.
const TOKEN_PATHS: Record<string, QrTargetKind> = {
  '/qr': 'login',
  '/verify-id': 'studentId',
  '/checkin': 'checkin',
}

export function parseQrTarget(raw: string): QrTarget | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  const path = url.pathname.replace(/\/+$/, '') || '/'

  const tokenKind = TOKEN_PATHS[path]
  if (tokenKind) {
    const token = url.searchParams.get('t')
    if (!token || token.length > MAX_TOKEN_LENGTH) return null
    return { kind: tokenKind, href: `${path}?t=${encodeURIComponent(token)}`, value: token }
  }

  const segments = path.split('/').filter(Boolean)
  const [head, second, third] = segments

  if (head === 'r' && second === 'resume' && segments.length === 3 && SLUG.test(third!)) {
    return { kind: 'resume', href: `/r/resume/${third}`, value: third! }
  }
  if (head === 'r' && segments.length === 2 && ROOM_CODE.test(second!)) {
    return { kind: 'room', href: `/r/${second}`, value: second! }
  }
  // Наклейка экземпляра книги (Фаза 20.3): тот же алфавит кодов, что у помещений.
  if (head === 'c' && segments.length === 2 && ROOM_CODE.test(second!)) {
    return { kind: 'bookCopy', href: `/c/${second}`, value: second! }
  }
  if (head === 'verify' && segments.length === 2 && SLUG.test(second!)) {
    return { kind: 'document', href: `/verify/${second}`, value: second! }
  }
  // Приглашение в группу: без кода `?k=` сервер не пустит, один id чата — не приглашение.
  if (head === 'join-chat' && segments.length === 2 && SLUG.test(second!)) {
    const code = url.searchParams.get('k')
    if (!code || code.length > MAX_TOKEN_LENGTH) return null
    return {
      kind: 'chatInvite',
      href: `/join-chat/${second}?k=${encodeURIComponent(code)}`,
      value: second!,
    }
  }
  return null
}
