import { Module } from '@nestjs/common'
import { PlatformController } from './platform.controller'
import { PlatformService } from './platform.service'

// Платформа: глобальные рычаги управления вебом (техработы, баннер, разделы, релиз).
// Читает состояние кто угодно; писать его будет админский мини-апп.
@Module({
  controllers: [PlatformController],
  providers: [PlatformService],
  exports: [PlatformService],
})
export class PlatformModule {}
