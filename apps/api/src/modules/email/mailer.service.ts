import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createTransport, type Transporter } from 'nodemailer'
import type { EnvVars } from '../../config/env.schema'

export interface OutgoingEmail {
  to: string
  subject: string
  html: string
  text: string
}

// Соединений в пуле SMTP — по конкурентности воркера писем (EmailProcessor).
const SMTP_MAX_CONNECTIONS = 5
// Таймауты SMTP. По умолчанию у nodemailer 2 минуты на соединение и 10 минут простоя
// сокета: зависший сервер держал бы обработчик очереди писем десятки минут.
const SMTP_CONNECTION_TIMEOUT_MS = 10_000
const SMTP_GREETING_TIMEOUT_MS = 10_000
const SMTP_SOCKET_TIMEOUT_MS = 30_000

// Тонкая обёртка над nodemailer. SMTP необязателен в dev/test (docs/PROJECT.md §13):
// при отсутствии SMTP_HOST используем jsonTransport — письма не уходят, а логируются,
// чтобы приложение и очередь работали без почтового сервера.
@Injectable()
export class MailerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailerService.name)
  private transporter!: Transporter
  private from!: string
  private smtpConfigured = false

  constructor(private readonly config: ConfigService<EnvVars, true>) {}

  onModuleInit(): void {
    const host = this.config.get('SMTP_HOST', { infer: true })
    this.from =
      this.config.get('SMTP_FROM', { infer: true }) ?? 'StudentHub <no-reply@studenthub.app>'

    if (host) {
      const port = this.config.get('SMTP_PORT', { infer: true }) ?? 587
      const user = this.config.get('SMTP_USER', { infer: true })
      const pass = this.config.get('SMTP_PASS', { infer: true })
      this.transporter = createTransport({
        // Пул вместо нового соединения (и TLS-рукопожатия) на каждое письмо.
        pool: true,
        maxConnections: SMTP_MAX_CONNECTIONS,
        host,
        port,
        secure: port === 465,
        auth: user && pass ? { user, pass } : undefined,
        connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
        greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
        socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
      })
      this.smtpConfigured = true
      this.logger.log(`SMTP настроен: ${host}:${port}`)
    } else {
      this.transporter = createTransport({ jsonTransport: true })
      this.logger.warn('SMTP не настроен — письма не отправляются, только логируются (dev/test)')
    }
  }

  // Пул держит открытые соединения — закрываем их при остановке процесса.
  onModuleDestroy(): void {
    this.transporter.close()
  }

  async send(email: OutgoingEmail): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...email })
    if (!this.smtpConfigured) {
      this.logger.debug(`[dev email] to=${email.to} subject="${email.subject}"`)
    }
  }
}
