import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createTransport, type Transporter } from 'nodemailer'
import type { EnvVars } from '../../config/env.schema'

export interface OutgoingEmail {
  to: string
  subject: string
  html: string
  text: string
}

// Тонкая обёртка над nodemailer. SMTP необязателен в dev/test (docs/PROJECT.md §13):
// при отсутствии SMTP_HOST используем jsonTransport — письма не уходят, а логируются,
// чтобы приложение и очередь работали без почтового сервера.
@Injectable()
export class MailerService implements OnModuleInit {
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
        host,
        port,
        secure: port === 465,
        auth: user && pass ? { user, pass } : undefined,
      })
      this.smtpConfigured = true
      this.logger.log(`SMTP настроен: ${host}:${port}`)
    } else {
      this.transporter = createTransport({ jsonTransport: true })
      this.logger.warn('SMTP не настроен — письма не отправляются, только логируются (dev/test)')
    }
  }

  async send(email: OutgoingEmail): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...email })
    if (!this.smtpConfigured) {
      this.logger.debug(`[dev email] to=${email.to} subject="${email.subject}"`)
    }
  }
}
