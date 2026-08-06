import { Module } from '@nestjs/common'
import { MailerService } from './mailer.service'
import { EmailProcessor } from './email.processor'

// Асинхронная отправка почты (docs/PROJECT.md §10.1). Очередь `email` регистрируется
// глобально в QueueModule; здесь — воркер и обёртка над nodemailer.
// MailerService экспортируется на случай прямой отправки (например, критичные системные письма).
@Module({
  providers: [MailerService, EmailProcessor],
  exports: [MailerService],
})
export class EmailModule {}
