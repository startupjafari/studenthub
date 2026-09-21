import { Global, Module } from '@nestjs/common'
import { TelegramNotifyService } from './telegram-notify.service'

// Исходящие уведомления в Telegram. Глобальный и без зависимостей, как AuditModule:
// уведомлять команду платформы нужно из жалоб и из поддержки, а импортировать ради этого
// MiniModule значило бы тянуть в оба домена AuthModule и снова рисковать кольцом импортов.
@Global()
@Module({
  providers: [TelegramNotifyService],
  exports: [TelegramNotifyService],
})
export class TelegramModule {}
