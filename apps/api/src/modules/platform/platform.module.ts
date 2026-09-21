import { Global, Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PlatformController } from './platform.controller'
import { PlatformService } from './platform.service'

// Платформа: глобальные рычаги управления вебом (техработы, баннер, разделы, релиз).
// Читает состояние кто угодно; писать его будет админский мини-апп.
// AuthModule — ради TwoFactorService: включение техработ подтверждается вторым фактором.
//
// Глобальный, как AuditModule: состояние платформы нужно MaintenanceGuard, который живёт
// рядом с остальными гардами в AuthModule. Обычный импорт замкнул бы модули в кольцо
// (Platform → Auth → Platform); глобальный провайдер разрывает его, не заводя forwardRef.
@Global()
@Module({
  imports: [AuthModule],
  controllers: [PlatformController],
  providers: [PlatformService],
  exports: [PlatformService],
})
export class PlatformModule {}
