import { Module } from '@nestjs/common'
import { ChatsModule } from '../chats/chats.module'
import { ComplaintsModule } from '../complaints/complaints.module'
import { TelegramHookController } from './telegram-hook.controller'
import { TelegramHookService } from './telegram-hook.service'

// Входящие обновления Telegram. Отдельный модуль, а не часть глобального TelegramModule:
// обработчику нужны SupportService и ComplaintsService, а глобальный модуль, импортирующий
// доменные, — прямой путь к кольцу импортов, из-за которого в этом эпике дважды переставало
// запускаться приложение. Здесь рёбра идут в одну сторону: hook → chats, hook → complaints.
@Module({
  imports: [ChatsModule, ComplaintsModule],
  controllers: [TelegramHookController],
  providers: [TelegramHookService],
})
export class TelegramHookModule {}
