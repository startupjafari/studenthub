import { Module } from '@nestjs/common'
import { ClientVersionController } from './client-version.controller'
import { ClientVersionService } from './client-version.service'

// Версия мобильного клиента (план iOS, Задача Б3). Модуль без таблиц и зависимостей:
// всё состояние — две переменные окружения.
@Module({
  controllers: [ClientVersionController],
  providers: [ClientVersionService],
})
export class ClientVersionModule {}
