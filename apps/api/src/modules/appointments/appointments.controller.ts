import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { AppointmentsService } from './appointments.service'
import { CreateAppointmentDto } from './dto/create-appointment.dto'
import { ConfirmAppointmentDto } from './dto/confirm-appointment.dto'
import { AppointmentListQueryDto } from './dto/appointment-list-query.dto'

const STUDENT_ROLES = [Role.STUDENT, Role.STAROSTA] as const
const MANAGE = [
  Role.PLATFORM_ADMIN,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
] as const

@ApiTags('Запись в деканат')
@ApiBearerAuth()
@Controller('deanery-appointments')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Post()
  @Roles(...STUDENT_ROLES)
  @ApiOperation({ summary: 'Записаться на приём в деканат' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateAppointmentDto,
    @Req() req: FastifyRequest,
  ) {
    return this.appointments.create(user, dto, this.ctx(req))
  }

  @Get('mine')
  @Roles(...STUDENT_ROLES)
  @ApiOperation({ summary: 'Мои записи' })
  mine(@CurrentUser() user: CurrentUserData) {
    return this.appointments.listMine(user)
  }

  @Post(':id/cancel')
  @Roles(...STUDENT_ROLES)
  @ApiOperation({ summary: 'Отменить свою запись' })
  cancel(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.appointments.cancelMine(user, id, this.ctx(req))
  }

  @Get('queue')
  @Roles(...MANAGE)
  @ApiOperation({ summary: 'Очередь записей факультета' })
  queue(@CurrentUser() user: CurrentUserData, @Query() query: AppointmentListQueryDto) {
    return this.appointments.listQueue(user, query)
  }

  @Post(':id/confirm')
  @Roles(...MANAGE)
  @ApiOperation({ summary: 'Подтвердить запись (назначить время)' })
  confirm(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ConfirmAppointmentDto,
    @Req() req: FastifyRequest,
  ) {
    return this.appointments.confirm(user, id, dto, 'CONFIRMED', this.ctx(req))
  }

  @Post(':id/reschedule')
  @Roles(...MANAGE)
  @ApiOperation({ summary: 'Перенести запись' })
  reschedule(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ConfirmAppointmentDto,
    @Req() req: FastifyRequest,
  ) {
    return this.appointments.confirm(user, id, dto, 'RESCHEDULED', this.ctx(req))
  }

  @Post(':id/complete')
  @Roles(...MANAGE)
  @ApiOperation({ summary: 'Завершить приём' })
  complete(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.appointments.setStatus(user, id, 'COMPLETED', this.ctx(req))
  }

  @Post(':id/staff-cancel')
  @Roles(...MANAGE)
  @ApiOperation({ summary: 'Отменить запись (деканат)' })
  staffCancel(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.appointments.setStatus(user, id, 'CANCELLED', this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
