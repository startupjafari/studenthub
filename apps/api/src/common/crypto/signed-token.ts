import { createHmac, timingSafeEqual } from 'node:crypto'

// Компактный подписанный токен `<base64url(payload)>.<base64url(hmac-sha256)>` для
// короткоживущих stateless-ссылок (QR-отметка посещаемости, верификация студенческого).
// Не замена JWT — только для внутренних одноразовых токенов с полем exp (ms epoch).

export interface SignedPayload {
  exp: number
}

export type VerifyResult<T> =
  { ok: true; payload: T } | { ok: false; reason: 'malformed' | 'invalid' | 'expired' }

function hmac(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url')
}

export function signToken<T extends SignedPayload>(payload: T, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${hmac(body, secret)}`
}

export function verifyToken<T extends SignedPayload>(
  token: string,
  secret: string,
  nowMs: number,
): VerifyResult<T> {
  const [body, sig] = token.split('.')
  if (!body || !sig) return { ok: false, reason: 'malformed' }
  const a = Buffer.from(sig)
  const b = Buffer.from(hmac(body, secret))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'invalid' }
  let payload: T
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (typeof payload.exp !== 'number' || nowMs > payload.exp)
    return { ok: false, reason: 'expired' }
  return { ok: true, payload }
}
