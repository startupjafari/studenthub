import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createPrivateKey, sign as cryptoSign, randomUUID } from 'node:crypto'
import { connect, constants, type ClientHttp2Session, type ClientHttp2Stream } from 'node:http2'
import type { EnvVars } from '../../config/env.schema'
import { apnsOutcome, buildApnsPayload, type ApnsMessage, type ApnsOutcome } from './apns.payload'

export type { ApnsMessage, ApnsOutcome }

// Сколько ждём ответа APNs на один пуш. Полуоткрытое HTTP/2-соединение после сетевого сбоя
// не присылает ни ответа, ни ошибки: без дедлайна промис не завершался никогда, а с ним
// вставали job и вся очередь уведомлений до перезапуска процесса.
const APNS_TIMEOUT_MS = 10_000

/**
 * Отправка пушей на устройства Apple (план iOS, Задача Б1).
 *
 * Без внешней библиотеки, и это осознанно: APNs — это один HTTP/2-запрос с
 * подписанным токеном в заголовке. `node:http2` и `node:crypto` дают и то, и
 * другое, а библиотека принесла бы свой пул соединений, свои ретраи и свой
 * жизненный цикл, которые всё равно пришлось бы изучать.
 *
 * Токен авторизации живёт у Apple не дольше часа и не должен выписываться чаще
 * раза в 20 минут, иначе соединение получает 429 TooManyProviderTokenUpdates —
 * поэтому он кэшируется на 50 минут, а не выписывается на каждый пуш.
 *
 * Без ключей сервис молчит: так же устроен Web Push, и dev-окружение не обязано
 * иметь доступ к боевым сертификатам.
 */
@Injectable()
export class ApnsService implements OnModuleDestroy {
  private readonly logger = new Logger(ApnsService.name)
  private session: ClientHttp2Session | null = null
  private cachedToken: { value: string; issuedAt: number } | null = null

  constructor(private readonly config: ConfigService<EnvVars, true>) {}

  onModuleDestroy(): void {
    this.session?.close()
    this.session = null
  }

  isEnabled(): boolean {
    return Boolean(
      this.config.get('APNS_KEY_ID', { infer: true }) &&
      this.config.get('APNS_TEAM_ID', { infer: true }) &&
      this.config.get('APNS_PRIVATE_KEY', { infer: true }) &&
      this.config.get('APNS_BUNDLE_ID', { infer: true }),
    )
  }

  async send(deviceToken: string, message: ApnsMessage): Promise<ApnsOutcome> {
    if (!this.isEnabled()) return 'disabled'

    const payload = buildApnsPayload(message)
    const headers = {
      [constants.HTTP2_HEADER_METHOD]: 'POST',
      [constants.HTTP2_HEADER_PATH]: `/3/device/${deviceToken}`,
      [constants.HTTP2_HEADER_AUTHORIZATION]: `bearer ${this.providerToken()}`,
      'apns-topic': this.config.get('APNS_BUNDLE_ID', { infer: true }),
      // Тихий пуш обязан быть background и приоритета 5: с 10 система его отбросит,
      // а повторять попытки APNs не станет.
      'apns-push-type': message.silent ? 'background' : 'alert',
      'apns-priority': message.silent ? '5' : '10',
      'apns-collapse-id': undefined as string | undefined,
      'apns-id': randomUUID(),
    }
    if (headers['apns-collapse-id'] === undefined) delete headers['apns-collapse-id']

    return new Promise<ApnsOutcome>((resolve) => {
      let status = 0
      let body = ''
      let settled = false
      let request: ClientHttp2Stream | undefined
      const session = this.connection()
      // Промис завершается ровно один раз — ответом, ошибкой, закрытием потока или дедлайном.
      const finish = (outcome: ApnsOutcome): void => {
        if (settled) return
        settled = true
        clearTimeout(deadline)
        resolve(outcome)
      }
      const deadline = setTimeout(() => {
        this.logger.warn(`APNs: нет ответа за ${APNS_TIMEOUT_MS} мс — соединение пересоздаём`)
        request?.close(constants.NGHTTP2_CANCEL)
        // Молчащее соединение само не оживёт: следующий пуш откроет новое.
        this.dropSession(session)
        finish('retry')
      }, APNS_TIMEOUT_MS)

      try {
        request = session.request(headers)
      } catch (error) {
        // Сессия успела закрыться между проверкой и запросом.
        this.logger.warn(`APNs: соединение недоступно (${String(error)})`)
        this.forgetSession(session)
        finish('retry')
        return
      }

      request.setEncoding('utf8')
      request.on('response', (responseHeaders) => {
        status = Number(responseHeaders[constants.HTTP2_HEADER_STATUS] ?? 0)
      })
      request.on('data', (chunk: string) => {
        body += chunk
      })
      request.on('error', (error) => {
        // Разорванное соединение — повод попробовать позже, а не выбрасывать токен.
        this.logger.warn(`APNs: соединение оборвалось (${String(error)})`)
        this.forgetSession(session)
        finish('retry')
      })
      request.on('end', () => {
        const outcome = apnsOutcome(status, body)
        if (outcome === 'retry') {
          this.logger.warn(`APNs: отказ ${status}`)
        }
        finish(outcome)
      })
      // Поток закрыт, не дочитав ответ (сессию разорвали без ошибки на потоке): без этого
      // промис ждал бы до дедлайна.
      request.on('close', () => finish('retry'))

      request.end(payload)
    })
  }

  // --- приватные ---

  private connection(): ClientHttp2Session {
    if (this.session && !this.session.closed && !this.session.destroyed) return this.session
    const host = this.config.get('APNS_PRODUCTION', { infer: true })
      ? 'https://api.push.apple.com'
      : 'https://api.sandbox.push.apple.com'
    const session = connect(host)
    // Ошибка, GOAWAY (APNs закрывает соединение при обслуживании) или закрытие — сессия
    // больше не годится, следующий пуш откроет новую.
    const forget = (): void => this.forgetSession(session)
    session.on('error', forget)
    session.on('goaway', forget)
    session.on('close', forget)
    this.session = session
    return session
  }

  /** Следующий пуш откроет новую сессию; уже открытую позже этой не трогаем. */
  private forgetSession(session: ClientHttp2Session): void {
    if (this.session === session) this.session = null
  }

  /** Забыть и закрыть молчащую сессию: её запросы не дождутся ответа и сразу уйдут в retry. */
  private dropSession(session: ClientHttp2Session): void {
    this.forgetSession(session)
    if (!session.destroyed) session.destroy()
  }

  /** Провайдерский токен: JWT ES256, подписанный ключом p8. */
  private providerToken(): string {
    const now = Math.floor(Date.now() / 1000)
    if (this.cachedToken && now - this.cachedToken.issuedAt < 50 * 60) {
      return this.cachedToken.value
    }

    const keyId = this.config.get('APNS_KEY_ID', { infer: true })
    const teamId = this.config.get('APNS_TEAM_ID', { infer: true })
    const header = this.base64url(JSON.stringify({ alg: 'ES256', kid: keyId }))
    const payload = this.base64url(JSON.stringify({ iss: teamId, iat: now }))

    // Переводы строк в переменной окружения приходят экранированными: ключ p8 —
    // многострочный PEM, и в одну строку он помещается только так.
    const pem = (this.config.get('APNS_PRIVATE_KEY', { infer: true }) ?? '').replace(/\\n/g, '\n')
    const signature = cryptoSign(null, Buffer.from(`${header}.${payload}`), {
      key: createPrivateKey(pem),
      // JOSE ждёт подпись в формате r||s, а Node по умолчанию отдаёт DER — с ним
      // Apple отвечает InvalidProviderToken, и причина не видна ниоткуда.
      dsaEncoding: 'ieee-p1363',
    })

    const value = `${header}.${payload}.${signature.toString('base64url')}`
    this.cachedToken = { value, issuedAt: now }
    return value
  }

  private base64url(value: string): string {
    return Buffer.from(value).toString('base64url')
  }
}
