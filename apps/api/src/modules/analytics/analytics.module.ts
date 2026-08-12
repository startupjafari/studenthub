import { Module } from '@nestjs/common'
import { AnalyticsService } from './analytics.service'
import { AnalyticsController } from './analytics.controller'

// Аналитика декана (docs/ACADEMIC_CORE.md, задача 14): read-only агрегаты по факультету.
@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
