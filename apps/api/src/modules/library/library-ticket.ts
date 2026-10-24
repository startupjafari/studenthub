import { createHash } from 'node:crypto'
import type { ConfigService } from '@nestjs/config'
import { signToken, verifyToken } from '../../common/crypto/signed-token'
import { AppException } from '../../common/exceptions/app.exception'
import type { EnvVars } from '../../config/env.schema'

// Пропуск на выдачу книг читателю (Фаза 20.4). QR студенческого живёт две минуты и разовый
// — за это время выдать несколько книг подряд удаётся не всегда. Библиотекарь сканирует его
// один раз и получает пропуск на 15 минут: только для себя, этого читателя и своего вуза.

const TICKET_TTL_MS = 15 * 60_000

interface TicketPayload {
  typ: 'library-reader'
  sub: string
  lib: string
  uni: string
  exp: number
}

/**
 * Ключ подписи — из JWT_ACCESS_SECRET с меткой назначения, как у QR посещаемости: одним
 * ключом не подписываются две несвязанные системы, а отдельной переменной окружения нет.
 */
function secret(config: ConfigService<EnvVars, true>): string {
  return createHash('sha256')
    .update(`${config.get('JWT_ACCESS_SECRET', { infer: true })}:library-reader:v1`)
    .digest('hex')
}

export function issueReaderTicket(
  config: ConfigService<EnvVars, true>,
  readerId: string,
  librarianId: string,
  universityId: string,
  now = Date.now(),
): { ticket: string; expiresAt: Date } {
  const exp = now + TICKET_TTL_MS
  const ticket = signToken<TicketPayload>(
    { typ: 'library-reader', sub: readerId, lib: librarianId, uni: universityId, exp },
    secret(config),
  )
  return { ticket, expiresAt: new Date(exp) }
}

/** Читатель по пропуску; чужой пропуск, истёкший или подделанный — понятный отказ. */
export function readTicket(
  config: ConfigService<EnvVars, true>,
  ticket: string,
  librarianId: string,
  universityId: string,
): string {
  const res = verifyToken<TicketPayload>(ticket, secret(config), Date.now())
  if (!res.ok) {
    throw new AppException(
      'CONFLICT',
      res.reason === 'expired'
        ? 'Пропуск читателя истёк — отсканируйте студенческий заново'
        : 'Пропуск читателя недействителен',
      [{ field: 'ticket', message: res.reason }],
    )
  }
  const p = res.payload
  if (p.typ !== 'library-reader' || p.lib !== librarianId || p.uni !== universityId) {
    throw new AppException('CONFLICT', 'Пропуск читателя выдан не вам', [
      { field: 'ticket', message: 'foreign' },
    ])
  }
  return p.sub
}
