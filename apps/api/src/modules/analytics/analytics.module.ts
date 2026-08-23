import { Module } from '@nestjs/common'
import { AnalyticsService } from './analytics.service'
import { AnalyticsController } from './analytics.controller'
import { PlatformAnalyticsService } from './platform-analytics.service'
import { PlatformAnalyticsController } from './platform-analytics.controller'

// Аналитика: агрегаты декана по факультету (ACADEMIC_CORE, задача 14) и
// агрегаты платформы для дашборда PLATFORM_ADMIN.
@Module({
  controllers: [AnalyticsController, PlatformAnalyticsController],
  providers: [AnalyticsService, PlatformAnalyticsService],
  exports: [AnalyticsService, PlatformAnalyticsService],
})
export class AnalyticsModule {}
