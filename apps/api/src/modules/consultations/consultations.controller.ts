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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { ConsultationsService } from './consultations.service'
import { CreateSlotDto } from './dto/create-slot.dto'
import { BookSlotDto } from './dto/book-slot.dto'
import { SlotListQueryDto } from './dto/slot-list-query.dto'

const STUDENT_ROLES = [Role.STUDENT, Role.STAROSTA] as const
const TEACHER_ROLES = [Role.TEACHER, Role.DEAN] as const

@ApiTags('Консультации')
@ApiBearerAuth()
@Controller('consultations')
export class ConsultationsController {
  constructor(private readonly consultations: ConsultationsService) {}

  @Get('mine')
  @ApiOperation({ summary: 'Мои консультации (препод — слоты, студент — записи)' })
  mine(@CurrentUser() user: CurrentUserData) {
    return this.consultations.listMine(user)
  }

  @Get('teachers')
  @Roles(...STUDENT_ROLES)
  @ApiOperation({ summary: 'Преподаватели с открытыми слотами (вуз)' })
  teachers(@CurrentUser() user: CurrentUserData) {
    return this.consultations.listTeachers(user)
  }

  @Get('slots')
  @Roles(...STUDENT_ROLES)
  @ApiOperation({ summary: 'Открытые слоты преподавателя (для записи)' })
  slots(@CurrentUser() user: CurrentUserData, @Query() query: SlotListQueryDto) {
    return this.consultations.listTeacherSlots(user, query.teacherId ?? '__none__')
  }

  @Post('slots')
  @Roles(...TEACHER_ROLES)
  @ApiOperation({ summary: 'Создать слот приёма (преподаватель)' })
  createSlot(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateSlotDto,
    @Req() req: FastifyRequest,
  ) {
    return this.consultations.createSlot(user, dto, this.ctx(req))
  }

  @Delete('slots/:id')
  @Roles(...TEACHER_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить свой слот' })
  async deleteSlot(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.consultations.deleteSlot(user, id, this.ctx(req))
  }

  @Post('slots/:id/book')
  @Roles(...STUDENT_ROLES)
  @ApiOperation({ summary: 'Записаться на консультацию' })
  book(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: BookSlotDto,
    @Req() req: FastifyRequest,
  ) {
    return this.consultations.book(user, id, dto, this.ctx(req))
  }

  @Post('slots/:id/cancel')
  @ApiOperation({ summary: 'Отменить запись (студент) или слот (преподаватель)' })
  cancel(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.consultations.cancel(user, id, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
