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
  requester?: QrRequester
  createdAt?: string
}

/**
 * Кто просит вход — показывается на телефоне перед подтверждением. Без этого QR-вход
 * уязвим к подмене (QRLjacking): злоумышленник присылает ссылку на свой QR «подтверди,
 * это проверка», и жертва одним нажатием отдаёт ему сессию, не видя, чей это компьютер.
 * IP маскируется: подтверждающему хватает сети и города, а не точного адреса.
 */
export interface QrRequester {
  browser: string | null
  os: string | null
  ip: string | null
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

  async create(ctx: { ip?: string; userAgent?: string } = {}): Promise<QrCreateResult> {
    const qrId = randomUUID()
    const approveToken = randomUUID()
    const claimSecret = randomUUID()
    const state: QrState = {
      approveToken,
      claimSecretHash: this.hash(claimSecret),
      status: 'pending',
      requester: describeRequester(ctx),
      createdAt: new Date().toISOString(),
    }
    await this.redis.set(key(qrId), JSON.stringify(state), 'EX', TTL_SECONDS)
    await this.redis.set(tokKey(approveToken), qrId, 'EX', TTL_SECONDS)

    const url = `${this.webBase()}/qr?t=${approveToken}`
    const qr = renderQrDataUrl(url)
    return { qrId, qr, claimSecret, expiresIn: TTL_SECONDS }
  }

  /** Что показать на телефоне до подтверждения: устройство и сеть, запросившие вход. */
  async preview(
    approveToken: string,
  ): Promise<{ requester: QrRequester; createdAt: string | null }> {
    const qrId = await this.redis.get(tokKey(approveToken))
    const state = qrId ? await this.read(qrId) : null
    if (!state || state.approveToken !== approveToken || state.status !== 'pending') {
      throw new AppException('NOT_FOUND', 'QR-сессия не найдена или истекла')
    }
    return {
      requester: state.requester ?? { browser: null, os: null, ip: null },
      createdAt: state.createdAt ?? null,
    }
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
    // Забирает тот, чей DEL удалил ключ: два одновременных claim с тем же секретом больше
    // не получают по сессии каждый.
    const removed = await this.redis.del(key(qrId))
    if (removed === 0) {
      throw new AppException('NOT_FOUND', 'QR-сессия не найдена или истекла')
    }
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

/** Браузер и ОС по User-Agent — грубо, ради подписи «Chrome · Windows», не для аналитики. */
export function describeRequester(ctx: { ip?: string; userAgent?: string }): QrRequester {
  const ua = ctx.userAgent ?? ''
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /YaBrowser\//.test(ua)
      ? 'Яндекс Браузер'
      : /OPR\//.test(ua)
        ? 'Opera'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : null
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad|iPod/.test(ua)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null
  return { browser, os, ip: maskIp(ctx.ip) }
}

// 203.0.113.57 → 203.0.113.x; 2001:db8:1:2::5 → 2001:db8:1::/48.
function maskIp(ip: string | undefined): string | null {
  if (!ip) return null
  const v4 = ip.replace(/^::ffff:/, '')
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return v4.replace(/\.\d+$/, '.x')
  const parts = ip.split(':').filter(Boolean)
  return parts.length >= 3 ? `${parts.slice(0, 3).join(':')}::/48` : null
}
