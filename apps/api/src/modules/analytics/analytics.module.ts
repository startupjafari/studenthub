import { Module } from '@nestjs/common'
import { AnalyticsService } from './analytics.service'
import { AnalyticsController } from './analytics.controller'
import { AnalyticsReportService } from './analytics-report.service'
import { AnalyticsReportController } from './analytics-report.controller'
import { PlatformAnalyticsService } from './platform-analytics.service'
import { PlatformAnalyticsController } from './platform-analytics.controller'
import { UniversityAnalyticsService } from './university-analytics.service'
import { UniversityAnalyticsController } from './university-analytics.controller'

// Аналитика: агрегаты декана по факультету (ACADEMIC_CORE, задача 14), агрегаты вуза
// для дашборда UNIVERSITY_ADMIN, агрегаты платформы для дашборда PLATFORM_ADMIN и
// выгрузка отчёта по любой из сводок файлом (Ф14.2).
@Module({
  controllers: [
    AnalyticsController,
    AnalyticsReportController,
    UniversityAnalyticsController,
    PlatformAnalyticsController,
  ],
  providers: [
    AnalyticsService,
    AnalyticsReportService,
    UniversityAnalyticsService,
    PlatformAnalyticsService,
  ],
  exports: [AnalyticsService, UniversityAnalyticsService, PlatformAnalyticsService],
})
export class AnalyticsModule {}
