import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { SchedulesService } from './schedules.service'
import { ScheduleQueryDto } from './dto/schedule-query.dto'
import { ScheduleChangeQueryDto } from './dto/schedule-change-query.dto'
import { CreateScheduleChangeDto } from './dto/create-schedule-change.dto'

// Просмотр расписания и разовых изменений (задачи 6.3, 6.5). Выборка ограничена ролью в сервисе.
@ApiTags('Расписание')
@ApiBearerAuth()
@Controller('schedule')
export class ScheduleViewController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get()
  @ApiOperation({
    summary: 'Расписание по scope роли (студент → группа, преподаватель → свои пары…)',
  })
  @ApiResponse({ status: 200, description: 'Пары активного расписания + таймзона вуза' })
  getSchedule(@CurrentUser() user: CurrentUserData, @Query() query: ScheduleQueryDto) {
    return this.schedules.getSchedule(user, query)
  }

  @Get('changes')
  @ApiOperation({ summary: 'Разовые изменения расписания за период [from, to]' })
  @ApiResponse({ status: 200, description: 'Список изменений в scope роли' })
  listChanges(@CurrentUser() user: CurrentUserData, @Query() query: ScheduleChangeQueryDto) {
    return this.schedules.listChanges(user, query)
  }

  @Post('changes')
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN)
  @ApiOperation({ summary: 'Создать замену/перенос/отмену (уведомление + WS schedule:changed)' })
  @ApiResponse({ status: 201, description: 'Изменение создано' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN / WRONG_SCOPE' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — пара не найдена' })
  @ApiResponse({
    status: 409,
    description: 'CONFLICT — занятие на дату отменено; преподаватель, аудитория или группа заняты',
  })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR — в т.ч. дата не в день пары' })
  createChange(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateScheduleChangeDto,
    @Req() req: FastifyRequest,
  ) {
    return this.schedules.createChange(user, dto, this.ctx(req))
  }

  @Delete('changes/:id')
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Убрать ошибочное разовое изменение (WS schedule:changed + уведомление)',
  })
  @ApiResponse({ status: 204, description: 'Изменение удалено' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN / WRONG_SCOPE' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — изменение не найдено' })
  async removeChange(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.schedules.removeChange(user, id, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
