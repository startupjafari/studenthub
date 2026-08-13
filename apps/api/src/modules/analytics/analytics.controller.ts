import { Controller, Get, Param, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { AnalyticsService } from './analytics.service'
import { FacultyAnalyticsQueryDto } from './dto/faculty-analytics-query.dto'

const ANALYTICS_ROLES = [
  Role.PLATFORM_ADMIN,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
] as const

@ApiTags('Аналитика')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('faculty')
  @Roles(...ANALYTICS_ROLES)
  @ApiOperation({ summary: 'Обзор факультета (показатели, группы, требует внимания)' })
  faculty(@CurrentUser() user: CurrentUserData, @Query() query: FacultyAnalyticsQueryDto) {
    return this.analytics.facultyOverview(user, query.facultyId)
  }

  @Get('at-risk')
  @Roles(...ANALYTICS_ROLES)
  @ApiOperation({ summary: 'Студенты «требует внимания» с явными причинами (Early Warning)' })
  atRisk(@CurrentUser() user: CurrentUserData, @Query() query: FacultyAnalyticsQueryDto) {
    return this.analytics.atRiskStudents(user, query.facultyId)
  }

  @Get('group/:id/attendance')
  @Roles(...ANALYTICS_ROLES)
  @ApiOperation({ summary: 'Посещаемость по студентам группы (drill-down)' })
  groupAttendance(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.analytics.groupAttendance(user, id)
  }
}
