import { createHash, randomBytes } from 'node:crypto'

// Токен агента камер: 256 бит случайности с узнаваемым префиксом — в логах и конфигах его
// видно сразу, и сканеры секретов ловят его по префиксу. Показывается админу один раз; в
// базе только SHA-256 (как у refresh-токенов, BACKEND_RULES §6.2: перебирать нечего).
const PREFIX = 'shca_'

export function newAgentToken(): string {
  return `${PREFIX}${randomBytes(32).toString('base64url')}`
}

export function hashAgentToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
