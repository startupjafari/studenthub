import { Module } from '@nestjs/common'
import { KatoService } from './kato.service'
import { KatoController } from './kato.controller'

// PrismaModule глобальный. Сервис экспортируется: резолв кода города понадобится
// другим модулям (профиль, вузы), а ходить в чужую таблицу напрямую нельзя (§2.1).
@Module({
  controllers: [KatoController],
  providers: [KatoService],
  exports: [KatoService],
})
export class KatoModule {}
