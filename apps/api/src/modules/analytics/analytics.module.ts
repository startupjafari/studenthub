import { Module } from '@nestjs/common'
import { AnalyticsService } from './analytics.service'
import { AnalyticsController } from './analytics.controller'
import { PlatformAnalyticsService } from './platform-analytics.service'
import { PlatformAnalyticsController } from './platform-analytics.controller'
import { UniversityAnalyticsService } from './university-analytics.service'
import { UniversityAnalyticsController } from './university-analytics.controller'

// Аналитика: агрегаты декана по факультету (ACADEMIC_CORE, задача 14), агрегаты вуза
// для дашборда UNIVERSITY_ADMIN и агрегаты платформы для дашборда PLATFORM_ADMIN.
@Module({
  controllers: [AnalyticsController, UniversityAnalyticsController, PlatformAnalyticsController],
  providers: [AnalyticsService, UniversityAnalyticsService, PlatformAnalyticsService],
  exports: [AnalyticsService, UniversityAnalyticsService, PlatformAnalyticsService],
})
export class AnalyticsModule {}
