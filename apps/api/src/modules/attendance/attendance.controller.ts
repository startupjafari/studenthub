import { Body, Controller, Get, Post, Put, Query, Req } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { AttendanceService } from './attendance.service'
import { AttendanceRosterQueryDto } from './dto/attendance-roster-query.dto'
import { MarkAttendanceDto } from './dto/mark-attendance.dto'
import { AttendanceSummaryQueryDto } from './dto/attendance-summary-query.dto'
import { QrTokenQueryDto } from './dto/qr-token-query.dto'
import { QrCheckInDto } from './dto/qr-check-in.dto'

const MARK_ROLES = [Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN, Role.TEACHER] as const
const STUDENT_ROLES = [Role.STUDENT, Role.STAROSTA] as const

@ApiTags('Посещаемость')
@ApiBearerAuth()
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('roster')
  @Roles(...MARK_ROLES)
  @ApiOperation({ summary: 'Ростер занятия (студенты + отметки) для преподавателя' })
  roster(@CurrentUser() user: CurrentUserData, @Query() query: AttendanceRosterQueryDto) {
    return this.attendance.roster(user, query)
  }

  @Put()
  @Roles(...MARK_ROLES)
  @ApiOperation({ summary: 'Проставить отметки занятия (массово)' })
  mark(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: MarkAttendanceDto,
    @Req() req: FastifyRequest,
  ) {
    return this.attendance.mark(user, dto, this.ctx(req))
  }

  @Get('me')
  @Roles(...STUDENT_ROLES)
  @ApiOperation({ summary: 'Сводка своей посещаемости (студент)' })
  me(@CurrentUser() user: CurrentUserData, @Query() query: AttendanceSummaryQueryDto) {
    return this.attendance.studentSummary(user, query)
  }

  @Get('qr')
  @Roles(...MARK_ROLES)
  @ApiOperation({ summary: 'QR занятия для самоотметки (преподаватель)' })
  qr(@CurrentUser() user: CurrentUserData, @Query() query: QrTokenQueryDto) {
    return this.attendance.createQrToken(user, query)
  }

  @Post('check-in')
  @Roles(...STUDENT_ROLES)
  @ApiOperation({ summary: 'Самоотметка на занятии по QR (студент)' })
  checkIn(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: QrCheckInDto,
    @Req() req: FastifyRequest,
  ) {
    return this.attendance.checkIn(user, dto, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
