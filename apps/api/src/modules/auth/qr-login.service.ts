import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, randomUUID } from 'node:crypto'
import type Redis from 'ioredis'
import { renderQrDataUrl } from '../../common/qr/qr-image'
import { REDIS_CLIENT } from '../../common/redis/redis.module'
import { AppException } from '../../common/exceptions/app.exception'
import type { EnvVars } from '../../config/env.schema'
import { QrLoginGateway } from './qr-login.gateway'

const TTL_SECONDS = 120
const key = (qrId: string): string => `qrlogin:${qrId}`
const tokKey = (approveToken: string): string => `qrlogin:tok:${approveToken}`

interface QrState {
  approveToken: string
  claimSecretHash: string
  status: 'pending' | 'approved'
  userId?: string
}

export interface QrCreateResult {
  qrId: string
  qr: string
  claimSecret: string
  expiresIn: number
}

// Вход по QR: короткоживущее состояние в Redis (TTL 2 мин, одноразовое). Десктоп создаёт
// сессию и получает claimSecret (в QR его нет); телефон подтверждает approveToken; десктоп
// забирает сессию по claimSecret. Гарантия: забрать сессию может только инициатор.
@Injectable()
export class QrLoginService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService<EnvVars, true>,
    private readonly gateway: QrLoginGateway,
  ) {}

  async create(): Promise<QrCreateResult> {
    const qrId = randomUUID()
    const approveToken = randomUUID()
    const claimSecret = randomUUID()
    const state: QrState = {
      approveToken,
      claimSecretHash: this.hash(claimSecret),
      status: 'pending',
    }
    await this.redis.set(key(qrId), JSON.stringify(state), 'EX', TTL_SECONDS)
    await this.redis.set(tokKey(approveToken), qrId, 'EX', TTL_SECONDS)

    const url = `${this.webBase()}/qr?t=${approveToken}`
    const qr = renderQrDataUrl(url)
    return { qrId, qr, claimSecret, expiresIn: TTL_SECONDS }
  }

  /** Телефон (авторизован) подтверждает вход: помечаем approved + userId, шлём WS-событие. */
  async approve(approveToken: string, userId: string): Promise<void> {
    const qrId = await this.redis.get(tokKey(approveToken))
    if (!qrId) {
      throw new AppException('NOT_FOUND', 'QR-сессия не найдена или истекла')
    }
    const state = await this.read(qrId)
    if (!state || state.approveToken !== approveToken) {
      throw new AppException('NOT_FOUND', 'QR-сессия не найдена или истекла')
    }
    state.status = 'approved'
    state.userId = userId
    // Сохраняем оставшийся TTL, чтобы у десктопа было время забрать сессию.
    const ttl = await this.redis.ttl(key(qrId))
    await this.redis.set(key(qrId), JSON.stringify(state), 'EX', ttl > 0 ? ttl : TTL_SECONDS)
    this.gateway.emitApproved(qrId)
  }

  /** Десктоп забирает сессию: сверяем claimSecret, отдаём userId и гасим сессию (одноразово). */
  async claim(qrId: string, claimSecret: string): Promise<string> {
    const state = await this.read(qrId)
    if (!state) {
      throw new AppException('NOT_FOUND', 'QR-сессия не найдена или истекла')
    }
    if (state.status !== 'approved' || !state.userId) {
      throw new AppException('BAD_REQUEST', 'Вход ещё не подтверждён')
    }
    if (this.hash(claimSecret) !== state.claimSecretHash) {
      throw new AppException('UNAUTHORIZED', 'Недопустимый секрет QR-сессии')
    }
    await this.redis.del(key(qrId))
    await this.redis.del(tokKey(state.approveToken))
    return state.userId
  }

  private async read(qrId: string): Promise<QrState | null> {
    const raw = await this.redis.get(key(qrId))
    return raw ? (JSON.parse(raw) as QrState) : null
  }

  private hash(secret: string): string {
    return createHash('sha256').update(secret).digest('hex')
  }

  // Базовый адрес веб-клиента для ссылки в QR (первый origin из CORS_ORIGIN).
  private webBase(): string {
    return this.config.get('CORS_ORIGIN', { infer: true }).split(',')[0]?.trim() ?? ''
  }
}
