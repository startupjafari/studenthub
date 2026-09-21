import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PlatformController } from './platform.controller'
import { PlatformService } from './platform.service'

// Платформа: глобальные рычаги управления вебом (техработы, баннер, разделы, релиз).
// Читает состояние кто угодно; писать его будет админский мини-апп.
// AuthModule — ради TwoFactorService: включение техработ подтверждается вторым фактором.
@Module({
  imports: [AuthModule],
  controllers: [PlatformController],
  providers: [PlatformService],
  exports: [PlatformService],
})
export class PlatformModule {}
