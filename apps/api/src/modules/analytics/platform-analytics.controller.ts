import { Controller, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../../common/decorators/roles.decorator'
import { MiniAllowed } from '../../common/decorators/mini-allowed.decorator'
import { PlatformAnalyticsService } from './platform-analytics.service'
import { PlatformActivityQueryDto } from './dto/platform-activity-query.dto'
import { PlatformRangeQueryDto } from './dto/platform-range-query.dto'
import { PlatformTopActionsQueryDto } from './dto/platform-top-actions-query.dto'

// Аналитика платформы — только платформенные роли: агрегаты идут по всем вузам,
// сужать их нечем и незачем (у роли нет universityId).
const PLATFORM_ROLES = [Role.PLATFORM_ADMIN, Role.PLATFORM_MODERATOR] as const

@ApiTags('Аналитика платформы')
@ApiBearerAuth()
@Controller('analytics/platform')
export class PlatformAnalyticsController {
  constructor(private readonly analytics: PlatformAnalyticsService) {}

  @Get('overview')
  @Roles(...PLATFORM_ROLES)
  // Единственная ручка аналитики, открытая мини-аппу: сводка отвечает на вопрос «всё ли в
  // порядке», который задают с телефона. Остальные — графики и разрезы, их читают за столом.
  @MiniAllowed()
  @ApiOperation({ summary: 'Плитки дашборда: вузы, пользователи, жалобы, DAU/WAU' })
  overview() {
    return this.analytics.overview()
  }

  @Get('users-growth')
  @Roles(...PLATFORM_ROLES)
  @ApiOperation({ summary: 'Новые пользователи по корзинам: студенты/преподаватели/сотрудники' })
  usersGrowth(@Query() query: PlatformRangeQueryDto) {
    return this.analytics.usersGrowth(query)
  }

  @Get('active-users')
  @Roles(...PLATFORM_ROLES)
  @ApiOperation({ summary: 'DAU/WAU по журналу аудита' })
  activeUsers(@Query() query: PlatformRangeQueryDto) {
    return this.analytics.activeUsers(query)
  }

  @Get('universities-size')
  @Roles(...PLATFORM_ROLES)
  @MiniAllowed()
  @ApiOperation({ summary: 'Размер вузов: студенты и преподаватели по каждому' })
  universitiesSize() {
    return this.analytics.universitiesSize()
  }

  @Get('complaints-flow')
  @Roles(...PLATFORM_ROLES)
  @ApiOperation({ summary: 'Жалобы: поступило и разобрано по корзинам' })
  complaintsFlow(@Query() query: PlatformRangeQueryDto) {
    return this.analytics.complaintsFlow(query)
  }

  @Get('complaints-latency')
  @Roles(...PLATFORM_ROLES)
  @ApiOperation({ summary: 'Время разбора жалоб: распределение по корзинам и медиана' })
  complaintsLatency(@Query() query: PlatformRangeQueryDto) {
    return this.analytics.complaintsLatency(query)
  }

  @Get('invites-funnel')
  @Roles(...PLATFORM_ROLES)
  @MiniAllowed()
  @ApiOperation({ summary: 'Воронка инвайтов: конверсия и статусы по корзинам' })
  invitesFunnel(@Query() query: PlatformRangeQueryDto) {
    return this.analytics.invitesFunnel(query)
  }

  @Get('activity-heatmap')
  @Roles(...PLATFORM_ROLES)
  @ApiOperation({
    summary: 'Активность по дням недели и часам, 7×24 + число дат каждого дня недели',
    description:
      'Часы раскладываются в зоне `tz` (IANA-имя, по умолчанию UTC). ' +
      '`days[dow]` — сколько календарных дат этого дня недели попало в период: ' +
      'делитель для сравнения будней с выходными.',
  })
  activityHeatmap(@Query() query: PlatformActivityQueryDto) {
    return this.analytics.activityHeatmap(query)
  }

  @Get('top-actions')
  @Roles(...PLATFORM_ROLES)
  @MiniAllowed()
  @ApiOperation({ summary: 'Топ действий в аудите за период' })
  topActions(@Query() query: PlatformTopActionsQueryDto) {
    return this.analytics.topActions(query)
  }
}
