import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createPrivateKey, sign as cryptoSign } from 'node:crypto'
import type { EnvVars } from '../../config/env.schema'
import { buildFcmMessage, fcmOutcome, type DeviceMessage, type FcmOutcome } from './fcm.payload'

export type { FcmOutcome }

const OAUTH_URL = 'https://oauth2.googleapis.com/token'
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'

/**
 * Отправка пушей на Android через FCM HTTP v1 (план Android, Задача АБ1).
 *
 * Без firebase-admin по той же причине, по которой APNs обходится без библиотеки:
 * отправка — один POST, а авторизация — JWT сервисного аккаунта, обменянный на
 * OAuth-токен. `fetch` и `node:crypto` дают и то, и другое; firebase-admin принёс бы
 * десятки мегабайт зависимостей ради двух запросов.
 *
 * OAuth-токен Google живёт час. Кэшируем на 50 минут: обмен на каждый пуш удваивал
 * бы число запросов и упирался в квоту, а запас в 10 минут спасает от токена,
 * протухшего по дороге.
 *
 * Без ключей сервис молчит — как APNs и Web Push.
 */
@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name)
  private cachedToken: { value: string; expiresAt: number } | null = null

  constructor(private readonly config: ConfigService<EnvVars, true>) {}

  isEnabled(): boolean {
    return Boolean(
      this.config.get('FCM_PROJECT_ID', { infer: true }) &&
      this.config.get('FCM_CLIENT_EMAIL', { infer: true }) &&
      this.config.get('FCM_PRIVATE_KEY', { infer: true }),
    )
  }

  async send(deviceToken: string, message: DeviceMessage): Promise<FcmOutcome> {
    if (!this.isEnabled()) return 'disabled'

    const projectId = this.config.get('FCM_PROJECT_ID', { infer: true })
    try {
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${await this.accessToken()}`,
            'content-type': 'application/json',
          },
          body: buildFcmMessage(deviceToken, message),
        },
      )
      const body = await response.text()
      if (response.status === 401) {
        // Токен отозвали раньше срока — выписываем новый в следующий раз.
        this.cachedToken = null
      }
      const outcome = fcmOutcome(response.status, body)
      if (outcome === 'retry') {
        this.logger.warn(`FCM: отказ ${response.status}`)
      }
      return outcome
    } catch (error) {
      // Сеть или обмен токена — повод попробовать позже, а не выбрасывать устройство.
      this.logger.warn(`FCM: запрос не прошёл (${String(error)})`)
      return 'retry'
    }
  }

  // --- приватные ---

  /** OAuth-токен Google в обмен на JWT, подписанный ключом сервисного аккаунта. */
  private async accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000)
    if (this.cachedToken && now < this.cachedToken.expiresAt) return this.cachedToken.value

    const response = await fetch(OAUTH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: this.assertion(now),
      }),
    })
    if (!response.ok) {
      throw new Error(`обмен токена: ${response.status}`)
    }
    const { access_token: value } = (await response.json()) as { access_token: string }
    this.cachedToken = { value, expiresAt: now + 50 * 60 }
    return value
  }

  /** JWT RS256 сервисного аккаунта — формат, который ждёт OAuth-эндпоинт Google. */
  private assertion(now: number): string {
    const header = this.base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const claims = this.base64url(
      JSON.stringify({
        iss: this.config.get('FCM_CLIENT_EMAIL', { infer: true }),
        scope: FCM_SCOPE,
        aud: OAUTH_URL,
        iat: now,
        exp: now + 60 * 60,
      }),
    )
    // Ключ из JSON сервисного аккаунта — многострочный PEM; в переменную окружения он
    // помещается только с экранированными переводами строк.
    const pem = (this.config.get('FCM_PRIVATE_KEY', { infer: true }) ?? '').replace(/\\n/g, '\n')
    const signature = cryptoSign(
      'RSA-SHA256',
      Buffer.from(`${header}.${claims}`),
      createPrivateKey(pem),
    )
    return `${header}.${claims}.${signature.toString('base64url')}`
  }

  private base64url(value: string): string {
    return Buffer.from(value).toString('base64url')
  }
}
