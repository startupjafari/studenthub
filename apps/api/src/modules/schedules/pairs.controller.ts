import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
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
import { CreatePairDto } from './dto/create-pair.dto'
import { UpdatePairDto } from './dto/update-pair.dto'

// Пары (задача 6.4). Создание/изменение проверяет конфликты аудитории/преподавателя/группы.
@ApiTags('Расписание')
@ApiBearerAuth()
@Controller('pairs')
export class PairsController {
  constructor(private readonly schedules: SchedulesService) {}

  @Post()
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN, Role.TEACHER)
  @ApiOperation({ summary: 'Добавить пару в расписание (с проверкой конфликтов)' })
  @ApiResponse({ status: 201, description: 'Пара создана' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN / WRONG_SCOPE' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — расписание/аудитория/преподаватель' })
  @ApiResponse({ status: 409, description: 'CONFLICT — слот занят (details[])' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreatePairDto,
    @Req() req: FastifyRequest,
  ) {
    return this.schedules.createPair(user, dto, this.ctx(req))
  }

  @Patch(':id')
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN, Role.TEACHER)
  @ApiOperation({ summary: 'Изменить пару (с проверкой конфликтов)' })
  @ApiResponse({ status: 200, description: 'Пара обновлена' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'CONFLICT — слот занят' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdatePairDto,
    @Req() req: FastifyRequest,
  ) {
    return this.schedules.updatePair(user, id, dto, this.ctx(req))
  }

  @Delete(':id')
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN, Role.TEACHER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить пару' })
  @ApiResponse({ status: 204, description: 'Удалено' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.schedules.removePair(user, id, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
