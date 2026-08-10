import { Global, Module } from '@nestjs/common'
import { PushService } from './push.service'
import { PushController } from './push.controller'

// Глобальный: PushService нужен процессору уведомлений (офлайн-доставка) без повторного импорта.
@Global()
@Module({
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
