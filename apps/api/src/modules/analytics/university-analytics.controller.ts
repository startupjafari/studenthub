import { Controller, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { UniversityAnalyticsService } from './university-analytics.service'
import { UniversityWeeksQueryDto } from './dto/university-weeks-query.dto'

// Аналитика вуза для дашборда администратора. Scope — universityId из токена,
// параметром вуз не принимается (§21).
const UNIVERSITY_ROLES = [Role.UNIVERSITY_ADMIN, Role.UNIVERSITY_MODERATOR] as const

@ApiTags('Аналитика')
@ApiBearerAuth()
@Controller('analytics/university')
export class UniversityAnalyticsController {
  constructor(private readonly analytics: UniversityAnalyticsService) {}

  @Get('attendance-trend')
  @Roles(...UNIVERSITY_ROLES)
  @ApiOperation({ summary: 'Посещаемость по неделям, отдельным рядом на факультет' })
  attendanceTrend(@CurrentUser() user: CurrentUserData, @Query() query: UniversityWeeksQueryDto) {
    return this.analytics.attendanceTrend(user, query.weeks)
  }

  @Get('attendance-breakdown')
  @Roles(...UNIVERSITY_ROLES)
  @ApiOperation({ summary: 'Структура посещаемости по факультетам (present/late/absent/excused)' })
  attendanceBreakdown(@CurrentUser() user: CurrentUserData) {
    return this.analytics.attendanceBreakdown(user)
  }

  @Get('room-load')
  @Roles(...UNIVERSITY_ROLES)
  @ApiOperation({ summary: 'Загрузка аудиторий: сетка «день недели × час», 7×24' })
  roomLoad(@CurrentUser() user: CurrentUserData) {
    return this.analytics.roomLoad(user)
  }

  @Get('exam-results')
  @Roles(...UNIVERSITY_ROLES)
  @ApiOperation({ summary: 'Исход экзаменов по факультетам (passed/failed/absent/retake)' })
  examResults(@CurrentUser() user: CurrentUserData) {
    return this.analytics.examResults(user)
  }

  @Get('applications-flow')
  @Roles(...UNIVERSITY_ROLES)
  @ApiOperation({ summary: 'Заявки по неделям: поступило, закрыто, закрыто с просрочкой' })
  applicationsFlow(@CurrentUser() user: CurrentUserData, @Query() query: UniversityWeeksQueryDto) {
    return this.analytics.applicationsFlow(user, query.weeks)
  }

  @Get('invites-funnel')
  @Roles(...UNIVERSITY_ROLES)
  @ApiOperation({ summary: 'Воронка приглашений вуза: выдано, принято, истекло, отозвано' })
  invitesFunnel(@CurrentUser() user: CurrentUserData) {
    return this.analytics.invitesFunnel(user)
  }
}
