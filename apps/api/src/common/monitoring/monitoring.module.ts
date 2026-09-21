import { Global, Module } from '@nestjs/common'

// Модуль наблюдаемости. Сейчас провайдеров нет: Sentry подключается в main.ts, а
// CronMonitorService живёт в CleanupModule — ему нужен SchedulerRegistry оттуда.
//
// Модуль оставлен точкой роста: следующий общий наблюдатель регистрируется здесь,
// а не расползается по CommonModule с его APP_FILTER/APP_INTERCEPTOR.
@Global()
@Module({})
export class MonitoringModule {}
