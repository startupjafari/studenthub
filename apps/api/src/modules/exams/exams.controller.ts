import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
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
import { ExamsService } from './exams.service'
import { CreateExamDto } from './dto/create-exam.dto'
import { UpdateExamDto } from './dto/update-exam.dto'
import { ExamListQueryDto } from './dto/exam-list-query.dto'
import { SetExamResultsDto } from './dto/set-exam-results.dto'

const MANAGE = [Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN, Role.TEACHER] as const

@ApiTags('Экзамены')
@ApiBearerAuth()
@Controller('exams')
export class ExamsController {
  constructor(private readonly exams: ExamsService) {}

  @Get()
  @ApiOperation({ summary: 'Экзамены по scope (студент — своя сессия + свой результат)' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: ExamListQueryDto) {
    return this.exams.list(user, query)
  }

  @Put('results')
  @Roles(...MANAGE)
  @ApiOperation({ summary: 'Проставить допуск/результаты (массово)' })
  setResults(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: SetExamResultsDto,
    @Req() req: FastifyRequest,
  ) {
    return this.exams.setResults(user, dto, this.ctx(req))
  }

  @Get(':id')
  @ApiOperation({ summary: 'Экзамен' })
  get(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.exams.getById(user, id)
  }

  @Get(':id/results')
  @Roles(...MANAGE)
  @ApiOperation({ summary: 'Ведомость экзамена (студенты + результаты)' })
  results(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.exams.results(user, id)
  }

  @Post()
  @Roles(...MANAGE)
  @ApiOperation({ summary: 'Назначить экзамен' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateExamDto,
    @Req() req: FastifyRequest,
  ) {
    return this.exams.create(user, dto, this.ctx(req))
  }

  @Patch(':id')
  @Roles(...MANAGE)
  @ApiOperation({ summary: 'Изменить экзамен' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateExamDto,
    @Req() req: FastifyRequest,
  ) {
    return this.exams.update(user, id, dto, this.ctx(req))
  }

  @Delete(':id')
  @Roles(...MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить экзамен' })
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.exams.remove(user, id, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
