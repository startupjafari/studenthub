import { Global, Module } from '@nestjs/common'
import { HttpStatusCounter } from './http-status.counter'

// Наблюдаемость, которой пользуются глобальные фильтр и интерцептор (docs/TELEGRAM_BOT.md §2.3).
//
// Отдельный @Global-модуль, а не провайдер внутри CommonModule: счётчик нужен и фильтру
// с интерцептором (они в CommonModule), и модулю наблюдения (`ops-notify`), а тащить
// CommonModule с его APP_FILTER/APP_INTERCEPTOR в чужие импорты ради одного класса — плохой
// обмен. `CronMonitorService` сюда не переезжает: ему нужен SchedulerRegistry, а тот живёт
// вместе с ScheduleModule в CleanupModule.
@Global()
@Module({
  providers: [HttpStatusCounter],
  exports: [HttpStatusCounter],
})
export class MonitoringModule {}
