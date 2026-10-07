import { Global, Module } from '@nestjs/common'
import { PushService } from './push.service'
import { ApnsService } from './apns.service'
import { PushController } from './push.controller'

// Глобальный: PushService нужен процессору уведомлений (офлайн-доставка) без повторного импорта.
@Global()
@Module({
  controllers: [PushController],
  providers: [PushService, ApnsService],
  exports: [PushService],
})
export class PushModule {}
